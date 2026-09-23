import { Worker, type Job } from "bullmq";
import { env } from "@/lib/env";
import { redis, closeRedis } from "@/lib/redis";
import { closeDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  FILA_DETECCAO,
  FILA_NOTIFICACAO,
  filaDeteccao,
  fecharFilas,
  type JobDeteccao,
  type JobNotificacao,
} from "@/queues";
import { pollSentinel, scanAnomalia } from "@/services/deteccao";
import { notificarAlerta } from "@/services/notificacao";
import { aplicarRetencao, executarExclusoesPendentes } from "@/services/lgpd";
import { listarTenantsAtivos } from "@/repositories/tenants";
import type { MetricaAcesso } from "@/domain/types";

const METRICAS: MetricaAcesso[] = ["logins", "requisicoes", "falhas_login"];

/**
 * Concorrência maior na notificação que na detecção: em pico de volume o gargalo
 * não pode ser o envio, senão o alerta crítico estoura o SLA de 5 minutos.
 */
const CONCORRENCIA_NOTIFICACAO = 10;
const CONCORRENCIA_DETECCAO = 4;

async function agendarCiclo(): Promise<void> {
  const tenants = await listarTenantsAtivos();
  for (const tenant of tenants) {
    await filaDeteccao().add(
      "poll",
      { tipo: "poll_sentinel", tenantId: tenant.id },
      { jobId: `poll-${tenant.id}-${Math.floor(Date.now() / env().SENTINEL_POLL_INTERVAL_MS)}` },
    );
  }
}

async function agendarScans(): Promise<void> {
  const tenants = await listarTenantsAtivos();
  const bucket = Math.floor(Date.now() / env().ANOMALY_SCAN_INTERVAL_MS);
  for (const tenant of tenants) {
    for (const metrica of METRICAS) {
      await filaDeteccao().add(
        "scan",
        { tipo: "scan_anomalia", tenantId: tenant.id, metrica },
        { jobId: `scan-${tenant.id}-${metrica}-${bucket}` },
      );
    }
  }
}

async function main(): Promise<void> {
  const config = env();

  const workerDeteccao = new Worker<JobDeteccao>(
    FILA_DETECCAO,
    async (job: Job<JobDeteccao>) => {
      if (job.data.tipo === "poll_sentinel") return pollSentinel(job.data.tenantId);
      return scanAnomalia({ tenantId: job.data.tenantId, metrica: job.data.metrica });
    },
    { connection: redis(), concurrency: CONCORRENCIA_DETECCAO },
  );

  const workerNotificacao = new Worker<JobNotificacao>(
    FILA_NOTIFICACAO,
    async (job: Job<JobNotificacao>) =>
      notificarAlerta({ tenantId: job.data.tenantId, alertaId: job.data.alertaId }),
    { connection: redis(), concurrency: CONCORRENCIA_NOTIFICACAO },
  );

  for (const worker of [workerDeteccao, workerNotificacao]) {
    worker.on("failed", (job, error) => {
      logger.error("job falhou", { fila: worker.name, jobId: job?.id, tentativa: job?.attemptsMade, error: error.message });
    });
  }

  const timers = [
    setInterval(() => void agendarCiclo().catch((e) => logger.error("falha ao agendar poll", { error: String(e) })), config.SENTINEL_POLL_INTERVAL_MS),
    setInterval(() => void agendarScans().catch((e) => logger.error("falha ao agendar scan", { error: String(e) })), config.ANOMALY_SCAN_INTERVAL_MS),
    setInterval(
      () =>
        void Promise.all([executarExclusoesPendentes(), aplicarRetencao()]).catch((e) =>
          logger.error("falha na rotina LGPD", { error: String(e) }),
        ),
      60 * 60 * 1000,
    ),
  ];

  await agendarCiclo();
  logger.info("worker do Cybergard no ar", {
    pollMs: config.SENTINEL_POLL_INTERVAL_MS,
    scanMs: config.ANOMALY_SCAN_INTERVAL_MS,
  });

  const encerrar = async (): Promise<void> => {
    logger.info("encerrando worker");
    timers.forEach(clearInterval);
    await Promise.all([workerDeteccao.close(), workerNotificacao.close()]);
    await fecharFilas();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => void encerrar());
  process.on("SIGINT", () => void encerrar());
}

main().catch((error) => {
  logger.error("worker não subiu", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
