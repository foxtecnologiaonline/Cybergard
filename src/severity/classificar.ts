import type { Severidade } from "@/domain/types";
import type { IncidenteSentinel, SeveridadeSentinel } from "@/azure/sentinel";
import type { ResultadoAnomalia } from "@/azure/anomaly-detector";
import type { MetricaAcesso } from "@/domain/types";

/** Táticas MITRE que promovem um incidente a crítico mesmo com severidade média na origem. */
const TATICAS_CRITICAS = new Set(["CredentialAccess", "PrivilegeEscalation", "Exfiltration", "Impact", "Ransomware"]);

const MAPA_SENTINEL: Record<SeveridadeSentinel, Severidade> = {
  High: "critico",
  Medium: "atencao",
  Low: "informativo",
  Informational: "informativo",
};

export function classificarIncidente(incidente: IncidenteSentinel): Severidade {
  const base = MAPA_SENTINEL[incidente.severidade] ?? "informativo";
  if (base === "atencao" && incidente.taticas.some((t) => TATICAS_CRITICAS.has(t))) {
    return "critico";
  }
  return base;
}

export interface ContextoAnomalia {
  metrica: MetricaAcesso;
  valor: number;
  resultado: ResultadoAnomalia;
  /** true quando a janela do evento caiu fora do horário comercial do tenant. */
  foraDoHorario: boolean;
}

/**
 * Severidade de anomalia de acesso. Pico de falha de login e pico fora do horário
 * são os dois sinais que a pequena empresa realmente precisa ver na hora.
 */
export function classificarAnomalia(ctx: ContextoAnomalia): Severidade {
  if (!ctx.resultado.isAnomaly) return "informativo";

  const forte = ctx.resultado.severity >= 0.5;
  const pico = ctx.resultado.isPositiveAnomaly;

  if (ctx.metrica === "falhas_login" && pico) {
    return forte || ctx.foraDoHorario ? "critico" : "atencao";
  }

  if (ctx.metrica === "logins" && pico && ctx.foraDoHorario) {
    return forte ? "critico" : "atencao";
  }

  if (ctx.metrica === "requisicoes" && pico) {
    return forte ? "atencao" : "informativo";
  }

  return "informativo";
}

/**
 * Ação recomendada em uma frase — v1 nunca contém automaticamente,
 * então a frase precisa dizer exatamente o que a pessoa deve fazer.
 */
export function acaoRecomendadaAnomalia(ctx: ContextoAnomalia): string {
  const quando = ctx.foraDoHorario ? " fora do horário comercial" : "";
  switch (ctx.metrica) {
    case "falhas_login":
      return `Confirme com sua equipe se alguém está tendo problema para entrar${quando}; se ninguém reconhecer, troque a senha das contas de administrador e ative a verificação em duas etapas.`;
    case "logins":
      return `Verifique com sua equipe quem acessou o sistema${quando}; se houver acesso não reconhecido, encerre as sessões ativas e troque a senha dessa conta.`;
    case "requisicoes":
      return `Acompanhe o volume de uso na próxima hora; se continuar acima do normal sem explicação de negócio, acione seu fornecedor de TI para checar automação ou varredura externa.`;
  }
}

export function acaoRecomendadaIncidente(incidente: IncidenteSentinel, severidade: Severidade): string {
  if (severidade === "critico") {
    return `Trate agora: isole a conta ou o equipamento citado no alerta, troque as senhas envolvidas e registre o ocorrido — não espere a próxima janela de manutenção.`;
  }
  if (severidade === "atencao") {
    return `Revise o alerta hoje com quem cuida da sua TI e confirme se a atividade "${incidente.titulo}" era esperada.`;
  }
  return `Nenhuma ação imediata: registre para acompanhamento e revise na conversa mensal de segurança.`;
}

/** Peso na fila: crítico nunca atrás de informativo em pico de volume (BullMQ: menor = mais prioritário). */
export const PRIORIDADE_FILA: Record<Severidade, number> = {
  critico: 1,
  atencao: 5,
  informativo: 10,
};

/** SLA do critério de aceite: alerta crítico em menos de 5 minutos do evento detectado. */
export const SLA_CRITICO_MS = 5 * 60 * 1000;

export function dentroDoSla(severidade: Severidade, latenciaMs: number): boolean {
  if (severidade !== "critico") return true;
  return latenciaMs < SLA_CRITICO_MS;
}

/** Hora local do tenant, para decidir "fora do horário" sem depender do fuso do servidor. */
export function horaLocal(instante: Date, fusoHorario: string): number {
  const formatador = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fusoHorario,
    hour: "numeric",
    hour12: false,
  });
  return Number(formatador.format(instante));
}

export function foraDoHorarioComercial(input: {
  instante: Date;
  fusoHorario: string;
  inicio: number;
  fim: number;
}): boolean {
  const hora = horaLocal(input.instante, input.fusoHorario);
  return hora < input.inicio || hora >= input.fim;
}
