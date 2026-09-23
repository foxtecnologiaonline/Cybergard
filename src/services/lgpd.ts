import { env } from "@/lib/env";
import { query, transaction } from "@/lib/db";
import { logger } from "@/lib/logger";
import { registrarAuditoria } from "@/repositories/tenants";

/**
 * Direito de esquecimento: marca o tenant para exclusão e apaga tudo em até 24h.
 * A marcação é imediata (o tenant para de receber e gerar dado); o purge roda no worker.
 */
export async function solicitarExclusaoTenant(input: { tenantId: string; solicitadoPor: string }): Promise<Date> {
  const excluirAte = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(`UPDATE tenants SET status = 'em_exclusao', excluir_ate = $2 WHERE id = $1`, [
    input.tenantId,
    excluirAte,
  ]);
  await registrarAuditoria({
    tenantId: input.tenantId,
    acao: "lgpd.exclusao_solicitada",
    ator: input.solicitadoPor,
    detalhes: { excluirAte: excluirAte.toISOString() },
  });
  logger.info("exclusão de tenant solicitada", { tenantId: input.tenantId, excluirAte });
  return excluirAte;
}

/** Executa a exclusão dos tenants cujo prazo venceu. Cascata do schema apaga os dados vinculados. */
export async function executarExclusoesPendentes(agora = new Date()): Promise<number> {
  const pendentes = await query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'em_exclusao' AND excluir_ate IS NOT NULL AND excluir_ate <= $1`,
    [agora],
  );

  for (const tenant of pendentes) {
    await transaction(async (client) => {
      await client.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
      // A auditoria sobrevive ao tenant (tenant_id nulo) — prova de que a exclusão ocorreu.
      await client.query(`INSERT INTO auditoria (tenant_id, acao, ator, detalhes) VALUES (NULL, $1, $2, $3)`, [
        "lgpd.exclusao_executada",
        "sistema",
        JSON.stringify({ tenantId: tenant.id, executadoEm: agora.toISOString() }),
      ]);
    });
    logger.info("tenant excluído por solicitação LGPD", { tenantId: tenant.id });
  }

  return pendentes.length;
}

/**
 * Minimização de dado: log bruto some na janela curta, alerta fica mais tempo
 * porque é o que sustenta a revisão mensal de falso positivo.
 */
export async function aplicarRetencao(agora = new Date()): Promise<{ eventos: number; alertas: number }> {
  const config = env();
  const limiteEventos = new Date(agora.getTime() - config.RAW_LOG_RETENTION_DAYS * 86_400_000);
  const limiteAlertas = new Date(agora.getTime() - config.ALERT_RETENTION_DAYS * 86_400_000);

  const eventos = await query<{ id: string }>(`DELETE FROM eventos_log WHERE recebido_em < $1 RETURNING id`, [
    limiteEventos,
  ]);
  const alertas = await query<{ id: string }>(`DELETE FROM alertas WHERE detectado_em < $1 RETURNING id`, [
    limiteAlertas,
  ]);

  if (eventos.length > 0 || alertas.length > 0) {
    logger.info("retenção aplicada", { eventos: eventos.length, alertas: alertas.length });
  }
  return { eventos: eventos.length, alertas: alertas.length };
}
