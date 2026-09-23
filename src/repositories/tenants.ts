import { query, queryOne } from "@/lib/db";
import type { Tenant, Destinatario, Severidade } from "@/domain/types";

export async function listarTenantsAtivos(): Promise<Tenant[]> {
  return query<Tenant>(
    `SELECT id, nome, fuso_horario, horario_inicio, horario_fim, status
       FROM tenants WHERE status = 'ativo' ORDER BY criado_em`,
  );
}

export async function buscarTenant(tenantId: string): Promise<Tenant | null> {
  return queryOne<Tenant>(
    `SELECT id, nome, fuso_horario, horario_inicio, horario_fim, status
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
}

export async function criarTenant(input: {
  nome: string;
  cnpj?: string | null;
  fusoHorario?: string;
  horarioInicio?: number;
  horarioFim?: number;
}): Promise<Tenant> {
  const rows = await query<Tenant>(
    `INSERT INTO tenants (nome, cnpj, fuso_horario, horario_inicio, horario_fim)
     VALUES ($1, $2, COALESCE($3, 'America/Sao_Paulo'), COALESCE($4, 8), COALESCE($5, 18))
     RETURNING id, nome, fuso_horario, horario_inicio, horario_fim, status`,
    [input.nome, input.cnpj ?? null, input.fusoHorario ?? null, input.horarioInicio ?? null, input.horarioFim ?? null],
  );
  const tenant = rows[0];
  if (!tenant) throw new Error("Falha ao criar tenant");
  return tenant;
}

/** Destinatários que devem receber um alerta desta severidade. */
export async function destinatariosPara(tenantId: string, severidade: Severidade): Promise<Destinatario[]> {
  const limiar: Record<Severidade, Severidade[]> = {
    critico: ["critico", "atencao", "informativo"],
    atencao: ["atencao", "informativo"],
    informativo: ["informativo"],
  };
  return query<Destinatario>(
    `SELECT id, tenant_id, nome, telefone_e164, severidade_minima, ativo
       FROM destinatarios
      WHERE tenant_id = $1 AND ativo AND severidade_minima = ANY($2::text[])
      ORDER BY criado_em`,
    [tenantId, limiar[severidade]],
  );
}

export async function adicionarDestinatario(input: {
  tenantId: string;
  nome: string;
  telefoneE164: string;
  severidadeMinima?: Severidade;
}): Promise<Destinatario> {
  const rows = await query<Destinatario>(
    `INSERT INTO destinatarios (tenant_id, nome, telefone_e164, severidade_minima)
     VALUES ($1, $2, $3, COALESCE($4, 'atencao'))
     ON CONFLICT (tenant_id, telefone_e164)
       DO UPDATE SET nome = EXCLUDED.nome,
                     severidade_minima = EXCLUDED.severidade_minima,
                     ativo = true
     RETURNING id, tenant_id, nome, telefone_e164, severidade_minima, ativo`,
    [input.tenantId, input.nome, input.telefoneE164, input.severidadeMinima ?? null],
  );
  const destinatario = rows[0];
  if (!destinatario) throw new Error("Falha ao adicionar destinatário");
  return destinatario;
}

export async function registrarAuditoria(input: {
  tenantId: string | null;
  acao: string;
  ator: string;
  detalhes?: Record<string, unknown>;
}): Promise<void> {
  await query(`INSERT INTO auditoria (tenant_id, acao, ator, detalhes) VALUES ($1, $2, $3, $4)`, [
    input.tenantId,
    input.acao,
    input.ator,
    JSON.stringify(input.detalhes ?? {}),
  ]);
}
