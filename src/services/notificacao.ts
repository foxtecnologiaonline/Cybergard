import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { buscarAlerta, marcarAlertaNotificado, registrarNotificacao } from "@/repositories/alertas";
import { destinatariosPara } from "@/repositories/tenants";
import { enviarAlerta } from "@/whatsapp/client";
import { dentroDoSla } from "@/severity/classificar";
import { gerarTokenAlerta } from "@/lib/link-alerta";

export interface ResultadoNotificacao {
  enviadas: number;
  falhas: number;
  latenciaMs: number | null;
  dentroDoSla: boolean;
}

/**
 * Entrega o alerta aos destinatários elegíveis e fecha a medição de latência.
 * Uma falha isolada de destinatário não bloqueia os demais, mas propaga pro retry da fila.
 */
export async function notificarAlerta(input: { tenantId: string; alertaId: string }): Promise<ResultadoNotificacao> {
  const alerta = await buscarAlerta(input.tenantId, input.alertaId);
  if (!alerta) throw new Error(`Alerta ${input.alertaId} não encontrado`);

  const destinatarios = await destinatariosPara(input.tenantId, alerta.severidade);
  if (destinatarios.length === 0) {
    logger.warn("alerta sem destinatário elegível", { tenantId: input.tenantId, alertaId: alerta.id });
    return { enviadas: 0, falhas: 0, latenciaMs: null, dentroDoSla: true };
  }

  const urlAlerta = `${env().APP_BASE_URL}/alertas/${alerta.id}?t=${gerarTokenAlerta(alerta.id)}`;
  let enviadas = 0;
  let falhas = 0;
  let ultimoErro: unknown = null;

  for (const destinatario of destinatarios) {
    try {
      const messageId = await enviarAlerta({
        telefoneE164: destinatario.telefone_e164,
        severidade: alerta.severidade,
        titulo: alerta.titulo,
        acaoRecomendada: alerta.acao_recomendada,
        detectadoEm: alerta.detectado_em,
        urlAlerta,
      });
      await registrarNotificacao({
        tenantId: input.tenantId,
        alertaId: alerta.id,
        destinatarioId: destinatario.id,
        status: "enviada",
        messageId,
      });
      enviadas++;
    } catch (error) {
      falhas++;
      ultimoErro = error;
      const mensagem = error instanceof Error ? error.message : String(error);
      await registrarNotificacao({
        tenantId: input.tenantId,
        alertaId: alerta.id,
        destinatarioId: destinatario.id,
        status: "falha",
        erro: mensagem,
      });
      logger.error("falha ao notificar destinatário", { alertaId: alerta.id, error: mensagem });
    }
  }

  if (enviadas === 0) {
    throw ultimoErro instanceof Error ? ultimoErro : new Error("Nenhuma notificação entregue");
  }

  const latenciaMs = await marcarAlertaNotificado(alerta.id, new Date());
  const ok = latenciaMs === null || dentroDoSla(alerta.severidade, latenciaMs);
  if (!ok) {
    logger.warn("alerta crítico fora do SLA de 5 minutos", { alertaId: alerta.id, latenciaMs });
  }

  return { enviadas, falhas, latenciaMs, dentroDoSla: ok };
}
