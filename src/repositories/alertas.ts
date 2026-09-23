import { query, queryOne } from "@/lib/db";
import type { Alerta, AlertaNovo, MetricaAcesso } from "@/domain/types";

export interface AlertaPersistido {
  alerta: Alerta;
  /** false quando a chave externa já existia — o poll é idempotente e não renotifica. */
  novo: boolean;
}

export async function salvarAlerta(input: AlertaNovo): Promise<AlertaPersistido> {
  const inserido = await queryOne<Alerta>(
    `INSERT INTO alertas (tenant_id, origem, chave_externa, titulo, descricao, severidade,
                          severidade_origem, acao_recomendada, detectado_em, metadados)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, origem, chave_externa) DO NOTHING
     RETURNING *`,
    [
      input.tenantId,
      input.origem,
      input.chaveExterna,
      input.titulo,
      input.descricao,
      input.severidade,
      input.severidadeOrigem,
      input.acaoRecomendada,
      input.detectadoEm,
      JSON.stringify(input.metadados),
    ],
  );

  if (inserido) return { alerta: inserido, novo: true };

  const existente = await queryOne<Alerta>(
    `SELECT * FROM alertas WHERE tenant_id = $1 AND origem = $2 AND chave_externa = $3`,
    [input.tenantId, input.origem, input.chaveExterna],
  );
  if (!existente) throw new Error("Alerta não encontrado após conflito de inserção");
  return { alerta: existente, novo: false };
}

export async function buscarAlerta(tenantId: string, alertaId: string): Promise<Alerta | null> {
  return queryOne<Alerta>(`SELECT * FROM alertas WHERE tenant_id = $1 AND id = $2`, [tenantId, alertaId]);
}

/** Marca o alerta como notificado e grava a latência detecção→envio (critério de aceite de 5 min). */
export async function marcarAlertaNotificado(alertaId: string, notificadoEm: Date): Promise<number | null> {
  const row = await queryOne<{ latencia_ms: number }>(
    `UPDATE alertas
        SET notificado_em = COALESCE(notificado_em, $2),
            latencia_ms = COALESCE(latencia_ms, EXTRACT(EPOCH FROM ($2 - detectado_em)) * 1000)
      WHERE id = $1
      RETURNING latencia_ms`,
    [alertaId, notificadoEm],
  );
  return row?.latencia_ms ?? null;
}

export async function listarAlertas(tenantId: string, limite = 50): Promise<Alerta[]> {
  return query<Alerta>(
    `SELECT * FROM alertas WHERE tenant_id = $1 ORDER BY detectado_em DESC LIMIT $2`,
    [tenantId, limite],
  );
}

export async function marcarFalsoPositivo(input: {
  tenantId: string;
  alertaId: string;
  falsoPositivo: boolean;
  revisadoPor: string;
}): Promise<void> {
  await query(
    `UPDATE alertas
        SET falso_positivo = $3, revisado_em = now(), revisado_por = $4
      WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.alertaId, input.falsoPositivo, input.revisadoPor],
  );
}

export interface ResumoFalsoPositivo {
  total: number;
  revisados: number;
  falsos_positivos: number;
  taxa: number;
  latencia_p95_ms: number | null;
  criticos_fora_do_sla: number;
}

/** Base da revisão mensal de falso positivo e do acompanhamento do SLA de 5 min. */
export async function resumoMensal(tenantId: string, desde: Date): Promise<ResumoFalsoPositivo> {
  const row = await queryOne<{
    total: string;
    revisados: string;
    falsos_positivos: string;
    latencia_p95_ms: number | null;
    criticos_fora_do_sla: string;
  }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE falso_positivo IS NOT NULL)::text AS revisados,
            COUNT(*) FILTER (WHERE falso_positivo)::text AS falsos_positivos,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latencia_ms) AS latencia_p95_ms,
            COUNT(*) FILTER (WHERE severidade = 'critico' AND latencia_ms > 300000)::text AS criticos_fora_do_sla
       FROM alertas
      WHERE tenant_id = $1 AND detectado_em >= $2`,
    [tenantId, desde],
  );

  const total = Number(row?.total ?? 0);
  const revisados = Number(row?.revisados ?? 0);
  const falsos = Number(row?.falsos_positivos ?? 0);
  return {
    total,
    revisados,
    falsos_positivos: falsos,
    taxa: revisados > 0 ? falsos / revisados : 0,
    latencia_p95_ms: row?.latencia_p95_ms ?? null,
    criticos_fora_do_sla: Number(row?.criticos_fora_do_sla ?? 0),
  };
}

export async function registrarNotificacao(input: {
  tenantId: string;
  alertaId: string;
  destinatarioId: string;
  status: "enviada" | "falha";
  messageId?: string | null;
  erro?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO notificacoes (tenant_id, alerta_id, destinatario_id, status, message_id, erro, tentativas, enviada_em)
     VALUES ($1, $2, $3, $4, $5, $6, 1, CASE WHEN $4 = 'enviada' THEN now() ELSE NULL END)
     ON CONFLICT (alerta_id, destinatario_id)
       DO UPDATE SET status = EXCLUDED.status,
                     message_id = EXCLUDED.message_id,
                     erro = EXCLUDED.erro,
                     tentativas = notificacoes.tentativas + 1,
                     enviada_em = CASE WHEN EXCLUDED.status = 'enviada' THEN now() ELSE notificacoes.enviada_em END`,
    [input.tenantId, input.alertaId, input.destinatarioId, input.status, input.messageId ?? null, input.erro ?? null],
  );
}

/** Série temporal de uma métrica de acesso, em ordem cronológica, para o Anomaly Detector. */
export async function serieMetrica(input: {
  tenantId: string;
  metrica: MetricaAcesso;
  pontos: number;
}): Promise<{ janela: Date; valor: number }[]> {
  const rows = await query<{ janela: Date; valor: number }>(
    `SELECT janela, valor FROM (
        SELECT janela, valor FROM metricas_acesso
         WHERE tenant_id = $1 AND metrica = $2
         ORDER BY janela DESC LIMIT $3
     ) s ORDER BY janela ASC`,
    [input.tenantId, input.metrica, input.pontos],
  );
  return rows;
}

export async function registrarMetrica(input: {
  tenantId: string;
  metrica: MetricaAcesso;
  janela: Date;
  valor: number;
}): Promise<void> {
  await query(
    `INSERT INTO metricas_acesso (tenant_id, metrica, janela, valor)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, metrica, janela) DO UPDATE SET valor = EXCLUDED.valor`,
    [input.tenantId, input.metrica, input.janela, input.valor],
  );
}

/** Recalcula a métrica da janela a partir dos eventos brutos já recebidos. */
export async function consolidarMetricasDaJanela(tenantId: string, janela: Date): Promise<void> {
  await query(
    `INSERT INTO metricas_acesso (tenant_id, metrica, janela, valor)
     SELECT $1, m.metrica, $2, COALESCE(c.total, 0)
       FROM (VALUES ('logins'), ('requisicoes'), ('falhas_login')) AS m(metrica)
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::double precision AS total
           FROM eventos_log e
          WHERE e.tenant_id = $1
            AND e.ocorrido_em >= $2 AND e.ocorrido_em < $2 + interval '1 hour'
            AND CASE m.metrica
                  WHEN 'logins' THEN e.tipo_evento = 'login'
                  WHEN 'falhas_login' THEN e.tipo_evento = 'login_falha'
                  ELSE true
                END
       ) c ON true
     ON CONFLICT (tenant_id, metrica, janela) DO UPDATE SET valor = EXCLUDED.valor`,
    [tenantId, janela],
  );
}

export async function cursorSentinel(tenantId: string): Promise<Date | null> {
  const row = await queryOne<{ ultimo_modificado_em: Date }>(
    `SELECT ultimo_modificado_em FROM cursores_sentinel WHERE tenant_id = $1`,
    [tenantId],
  );
  return row?.ultimo_modificado_em ?? null;
}

export async function salvarCursorSentinel(tenantId: string, ultimoModificadoEm: Date): Promise<void> {
  await query(
    `INSERT INTO cursores_sentinel (tenant_id, ultimo_modificado_em)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id)
       DO UPDATE SET ultimo_modificado_em = GREATEST(cursores_sentinel.ultimo_modificado_em, EXCLUDED.ultimo_modificado_em),
                     atualizado_em = now()`,
    [tenantId, ultimoModificadoEm],
  );
}
