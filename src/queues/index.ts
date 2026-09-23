import { Queue, type JobsOptions } from "bullmq";
import { redis } from "@/lib/redis";
import type { Severidade, MetricaAcesso } from "@/domain/types";
import { PRIORIDADE_FILA } from "@/severity/classificar";

// BullMQ rejeita ":" em nome de fila (o caractere é separador das chaves no Redis).
export const FILA_INGESTAO = "cybergard-ingestao";
export const FILA_NOTIFICACAO = "cybergard-notificacao";
export const FILA_DETECCAO = "cybergard-deteccao";

export interface JobIngestao {
  tenantId: string;
  fonteId: string;
  eventoIds: string[];
}

export interface JobNotificacao {
  tenantId: string;
  alertaId: string;
  severidade: Severidade;
  detectadoEmIso: string;
}

export type JobDeteccao =
  | { tipo: "poll_sentinel"; tenantId: string }
  | { tipo: "scan_anomalia"; tenantId: string; metrica: MetricaAcesso };

let ingestao: Queue<JobIngestao> | null = null;
let notificacao: Queue<JobNotificacao> | null = null;
let deteccao: Queue<JobDeteccao> | null = null;

const PADRAO: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 86_400, count: 5_000 },
  removeOnFail: { age: 604_800 },
};

export function filaIngestao(): Queue<JobIngestao> {
  ingestao ??= new Queue<JobIngestao>(FILA_INGESTAO, { connection: redis(), defaultJobOptions: PADRAO });
  return ingestao;
}

export function filaNotificacao(): Queue<JobNotificacao> {
  notificacao ??= new Queue<JobNotificacao>(FILA_NOTIFICACAO, { connection: redis(), defaultJobOptions: PADRAO });
  return notificacao;
}

export function filaDeteccao(): Queue<JobDeteccao> {
  deteccao ??= new Queue<JobDeteccao>(FILA_DETECCAO, { connection: redis(), defaultJobOptions: PADRAO });
  return deteccao;
}

/**
 * Enfileira a notificação com prioridade pela severidade: em pico de volume,
 * o crítico é puxado antes de qualquer informativo que já estava na fila.
 */
export async function enfileirarNotificacao(job: JobNotificacao): Promise<void> {
  await filaNotificacao().add("notificar", job, {
    priority: PRIORIDADE_FILA[job.severidade],
    // Uma notificação por alerta, mesmo que o poll veja o incidente de novo.
    jobId: `alerta-${job.alertaId}`,
  });
}

export async function fecharFilas(): Promise<void> {
  await Promise.all([ingestao?.close(), notificacao?.close(), deteccao?.close()]);
  ingestao = null;
  notificacao = null;
  deteccao = null;
}
