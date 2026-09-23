import { query, queryOne } from "@/lib/db";
import { encryptSecret, generateIngestToken, hashIngestToken } from "@/lib/crypto";
import type { EventoLog, FonteLog, TipoFonteLog } from "@/domain/types";

export interface FonteComToken {
  fonte: FonteLog;
  /** Token em claro — devolvido uma única vez, no onboarding. Só o hash fica persistido. */
  tokenIngest: string;
}

export async function criarFonteLog(input: {
  tenantId: string;
  tipo: TipoFonteLog;
  nome: string;
  credenciais?: Record<string, string> | null;
}): Promise<FonteComToken> {
  const token = generateIngestToken();
  const rows = await query<FonteLog>(
    `INSERT INTO fontes_log (tenant_id, tipo, nome, credenciais_cifradas, token_ingest_hash, status)
     VALUES ($1, $2, $3, $4, $5, 'pendente')
     RETURNING id, tenant_id, tipo, nome, status, ultimo_evento_em, ultimo_erro`,
    [
      input.tenantId,
      input.tipo,
      input.nome,
      input.credenciais ? encryptSecret(JSON.stringify(input.credenciais)) : null,
      hashIngestToken(token),
    ],
  );
  const fonte = rows[0];
  if (!fonte) throw new Error("Falha ao criar fonte de log");
  return { fonte, tokenIngest: token };
}

export async function listarFontes(tenantId: string): Promise<FonteLog[]> {
  return query<FonteLog>(
    `SELECT id, tenant_id, tipo, nome, status, ultimo_evento_em, ultimo_erro
       FROM fontes_log WHERE tenant_id = $1 ORDER BY criado_em`,
    [tenantId],
  );
}

/** Resolve a fonte a partir do token de ingestão. O token nunca é comparado em claro no banco. */
export async function autenticarFontePorToken(token: string): Promise<FonteLog | null> {
  return queryOne<FonteLog>(
    `SELECT f.id, f.tenant_id, f.tipo, f.nome, f.status, f.ultimo_evento_em, f.ultimo_erro
       FROM fontes_log f
       JOIN tenants t ON t.id = f.tenant_id
      WHERE f.token_ingest_hash = $1 AND t.status = 'ativo'`,
    [hashIngestToken(token)],
  );
}

export async function marcarFonteConectada(fonteId: string, ocorridoEm: Date): Promise<void> {
  await query(
    `UPDATE fontes_log
        SET status = 'conectada', ultimo_evento_em = GREATEST(COALESCE(ultimo_evento_em, $2), $2), ultimo_erro = NULL
      WHERE id = $1`,
    [fonteId, ocorridoEm],
  );
}

export async function marcarFonteErro(fonteId: string, erro: string): Promise<void> {
  await query(`UPDATE fontes_log SET status = 'erro', ultimo_erro = $2 WHERE id = $1`, [fonteId, erro.slice(0, 500)]);
}

export async function salvarEventos(eventos: EventoLog[]): Promise<number> {
  if (eventos.length === 0) return 0;

  const values: string[] = [];
  const params: unknown[] = [];
  eventos.forEach((evento, index) => {
    const base = index * 7;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
    params.push(
      evento.tenantId,
      evento.fonteId,
      evento.ocorridoEm,
      evento.tipoEvento,
      evento.ator,
      evento.ipOrigem,
      JSON.stringify(evento.payload),
    );
  });

  const rows = await query<{ id: string }>(
    `INSERT INTO eventos_log (tenant_id, fonte_id, ocorrido_em, tipo_evento, ator, ip_origem, payload)
     VALUES ${values.join(", ")}
     RETURNING id`,
    params,
  );
  return rows.length;
}

export async function marcarEventosEnviados(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await query(`UPDATE eventos_log SET enviado_sentinel = true WHERE id = ANY($1::bigint[])`, [ids]);
}
