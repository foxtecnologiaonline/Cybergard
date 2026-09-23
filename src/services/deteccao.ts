import { logger } from "@/lib/logger";
import { listarIncidentes } from "@/azure/sentinel";
import { detectarUltimoPonto, MINIMO_DE_PONTOS } from "@/azure/anomaly-detector";
import {
  classificarIncidente,
  classificarAnomalia,
  acaoRecomendadaIncidente,
  acaoRecomendadaAnomalia,
  foraDoHorarioComercial,
  type ContextoAnomalia,
} from "@/severity/classificar";
import { cursorSentinel, salvarCursorSentinel, salvarAlerta, serieMetrica } from "@/repositories/alertas";
import { buscarTenant } from "@/repositories/tenants";
import { enfileirarNotificacao } from "@/queues";
import type { MetricaAcesso, Severidade, Tenant } from "@/domain/types";

/** Quantos pontos da série vão para o detector — 7 dias de janela horária. */
const PONTOS_DA_SERIE = 168;

/**
 * Lê incidentes novos do Sentinel, classifica e enfileira notificação.
 * O cursor só avança depois do alerta persistido, então uma falha reprocessa em vez de perder.
 */
export async function pollSentinel(tenantId: string): Promise<{ lidos: number; novos: number }> {
  const desde = await cursorSentinel(tenantId);
  const incidentes = await listarIncidentes(desde);
  let novos = 0;

  for (const incidente of incidentes) {
    const severidade = classificarIncidente(incidente);
    const { alerta, novo } = await salvarAlerta({
      tenantId,
      origem: "sentinel",
      chaveExterna: incidente.id,
      titulo: incidente.titulo,
      descricao: incidente.descricao,
      severidade,
      severidadeOrigem: incidente.severidade,
      acaoRecomendada: acaoRecomendadaIncidente(incidente, severidade),
      detectadoEm: incidente.criadoEm,
      metadados: {
        incidentNumber: incidente.numero,
        status: incidente.status,
        taticas: incidente.taticas,
        urlPortal: incidente.urlPortal,
      },
    });

    await salvarCursorSentinel(tenantId, incidente.modificadoEm);

    if (novo) {
      novos++;
      await enfileirarNotificacao({
        tenantId,
        alertaId: alerta.id,
        severidade,
        detectadoEmIso: alerta.detectado_em.toISOString(),
      });
    }
  }

  logger.info("poll do Sentinel concluído", { tenantId, lidos: incidentes.length, novos });
  return { lidos: incidentes.length, novos };
}

const TITULO_METRICA: Record<MetricaAcesso, string> = {
  logins: "Volume de acessos fora do padrão",
  requisicoes: "Volume de requisições fora do padrão",
  falhas_login: "Pico de tentativas de login malsucedidas",
};

/**
 * Roda o Anomaly Detector sobre a última janela da métrica e gera alerta se destoar.
 * Série curta demais não vira alerta — o modelo precisa de histórico pra não disparar falso positivo.
 */
export async function scanAnomalia(input: {
  tenantId: string;
  metrica: MetricaAcesso;
}): Promise<{ analisado: boolean; alertou: boolean }> {
  const tenant = await buscarTenant(input.tenantId);
  if (!tenant) return { analisado: false, alertou: false };

  const serie = await serieMetrica({ tenantId: input.tenantId, metrica: input.metrica, pontos: PONTOS_DA_SERIE });
  if (serie.length < MINIMO_DE_PONTOS) {
    logger.debug("série curta para detecção", { tenantId: input.tenantId, metrica: input.metrica, pontos: serie.length });
    return { analisado: false, alertou: false };
  }

  const resultado = await detectarUltimoPonto({
    serie: serie.map((p) => ({ timestamp: p.janela, value: p.valor })),
  });
  if (!resultado) return { analisado: false, alertou: false };

  const ultimo = serie[serie.length - 1]!;
  const foraDoHorario = foraDoHorarioComercial({
    instante: ultimo.janela,
    fusoHorario: tenant.fuso_horario,
    inicio: tenant.horario_inicio,
    fim: tenant.horario_fim,
  });

  const contexto = { metrica: input.metrica, valor: ultimo.valor, resultado, foraDoHorario };
  const severidade = classificarAnomalia(contexto);

  if (!resultado.isAnomaly) return { analisado: true, alertou: false };

  const alertou = await registrarAlertaDeAnomalia({ tenant, contexto, janela: ultimo.janela, severidade });
  return { analisado: true, alertou };
}

async function registrarAlertaDeAnomalia(input: {
  tenant: Tenant;
  contexto: ContextoAnomalia;
  janela: Date;
  severidade: Severidade;
}): Promise<boolean> {
  const { tenant, contexto, janela, severidade } = input;
  const { alerta, novo } = await salvarAlerta({
    tenantId: tenant.id,
    origem: "anomaly_detector",
    // Uma anomalia por métrica e janela — reexecutar o scan não duplica alerta.
    chaveExterna: `${contexto.metrica}:${janela.toISOString()}`,
    titulo: TITULO_METRICA[contexto.metrica],
    descricao:
      `Registramos ${contexto.valor} ocorrência(s) de ${contexto.metrica.replace("_", " ")} nesta hora, ` +
      `contra ${contexto.resultado.expectedValue.toFixed(1)} esperada(s) para o seu padrão` +
      `${contexto.foraDoHorario ? ", fora do horário comercial" : ""}.`,
    severidade,
    severidadeOrigem: contexto.resultado.severity.toFixed(2),
    acaoRecomendada: acaoRecomendadaAnomalia(contexto),
    // O SLA de 5 min conta da detecção, não do início da janela analisada.
    detectadoEm: new Date(),
    metadados: {
      metrica: contexto.metrica,
      janela: janela.toISOString(),
      valor: contexto.valor,
      esperado: contexto.resultado.expectedValue,
      severityDetector: contexto.resultado.severity,
      foraDoHorario: contexto.foraDoHorario,
    },
  });

  if (!novo) return false;

  await enfileirarNotificacao({
    tenantId: tenant.id,
    alertaId: alerta.id,
    severidade,
    detectadoEmIso: alerta.detectado_em.toISOString(),
  });
  return true;
}
