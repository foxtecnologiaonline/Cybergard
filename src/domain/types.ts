export type Severidade = "critico" | "atencao" | "informativo";

export type OrigemAlerta = "sentinel" | "anomaly_detector";

export type TipoFonteLog = "painel_admin" | "email_corporativo" | "webhook_generico";

export type MetricaAcesso = "logins" | "requisicoes" | "falhas_login";

export interface Tenant {
  id: string;
  nome: string;
  fuso_horario: string;
  horario_inicio: number;
  horario_fim: number;
  status: "ativo" | "suspenso" | "em_exclusao";
}

export interface Destinatario {
  id: string;
  tenant_id: string;
  nome: string;
  telefone_e164: string;
  severidade_minima: Severidade;
  ativo: boolean;
}

export interface FonteLog {
  id: string;
  tenant_id: string;
  tipo: TipoFonteLog;
  nome: string;
  status: "pendente" | "conectada" | "erro";
  ultimo_evento_em: Date | null;
  ultimo_erro: string | null;
}

export interface EventoLog {
  tenantId: string;
  fonteId: string;
  ocorridoEm: Date;
  tipoEvento: string;
  ator: string | null;
  ipOrigem: string | null;
  payload: Record<string, unknown>;
}

export interface Alerta {
  id: string;
  tenant_id: string;
  origem: OrigemAlerta;
  chave_externa: string;
  titulo: string;
  descricao: string;
  severidade: Severidade;
  severidade_origem: string | null;
  acao_recomendada: string;
  detectado_em: Date;
  criado_em: Date;
  notificado_em: Date | null;
  latencia_ms: number | null;
  falso_positivo: boolean | null;
  metadados: Record<string, unknown>;
}

/** Alerta antes de persistir — sem id nem timestamps do banco. */
export interface AlertaNovo {
  tenantId: string;
  origem: OrigemAlerta;
  chaveExterna: string;
  titulo: string;
  descricao: string;
  severidade: Severidade;
  severidadeOrigem: string | null;
  acaoRecomendada: string;
  detectadoEm: Date;
  metadados: Record<string, unknown>;
}
