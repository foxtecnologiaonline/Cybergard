import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  autenticarFontePorToken,
  marcarFonteConectada,
  registrarErroEncaminhamento,
  salvarEventos,
} from "@/repositories/fontes-log";
import { consolidarMetricasDaJanela } from "@/repositories/alertas";
import { enviarParaSentinel } from "@/azure/logs-ingestion";
import type { EventoLog, FonteLog } from "@/domain/types";

export const eventoSchema = z.object({
  ocorridoEm: z.string().datetime(),
  tipoEvento: z.string().min(1).max(100),
  ator: z.string().max(200).nullish(),
  ipOrigem: z.string().ip().nullish(),
  payload: z.record(z.unknown()).default({}),
});

export const loteSchema = z.object({
  eventos: z.array(eventoSchema).min(1),
});

export type EventoEntrada = z.infer<typeof eventoSchema>;

export class LoteMuitoGrandeError extends Error {
  constructor(readonly limite: number) {
    super(`Lote acima do limite de ${limite} eventos`);
    this.name = "LoteMuitoGrandeError";
  }
}

/** Trunca a janela pra hora cheia — é a granularidade da série do Anomaly Detector. */
export function janelaHoraria(instante: Date): Date {
  const janela = new Date(instante);
  janela.setUTCMinutes(0, 0, 0);
  return janela;
}

/**
 * Recebe o lote de uma fonte conectada: persiste, consolida a métrica da janela
 * e encaminha pro Sentinel. Falha no Sentinel não descarta o evento já persistido.
 */
export async function ingerirLote(input: {
  token: string;
  eventos: EventoEntrada[];
}): Promise<{ fonte: FonteLog; persistidos: number; encaminhados: boolean }> {
  const limite = env().INGEST_MAX_BATCH;
  if (input.eventos.length > limite) throw new LoteMuitoGrandeError(limite);

  const fonte = await autenticarFontePorToken(input.token);
  if (!fonte) throw new Error("Token de ingestão inválido");

  const eventos: EventoLog[] = input.eventos.map((evento) => ({
    tenantId: fonte.tenant_id,
    fonteId: fonte.id,
    ocorridoEm: new Date(evento.ocorridoEm),
    tipoEvento: evento.tipoEvento,
    ator: evento.ator ?? null,
    ipOrigem: evento.ipOrigem ?? null,
    payload: evento.payload,
  }));

  const persistidos = await salvarEventos(eventos);

  const maisRecente = eventos.reduce((max, e) => (e.ocorridoEm > max ? e.ocorridoEm : max), eventos[0]!.ocorridoEm);
  await marcarFonteConectada(fonte.id, maisRecente);

  const janelas = new Set(eventos.map((e) => janelaHoraria(e.ocorridoEm).toISOString()));
  for (const janela of janelas) {
    await consolidarMetricasDaJanela(fonte.tenant_id, new Date(janela));
  }

  let encaminhados = false;
  try {
    await enviarParaSentinel(eventos);
    encaminhados = true;
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    await registrarErroEncaminhamento(fonte.id, mensagem);
    logger.error("falha ao encaminhar eventos ao Sentinel", { fonteId: fonte.id, error: mensagem });
  }

  return { fonte, persistidos, encaminhados };
}
