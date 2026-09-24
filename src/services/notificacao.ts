import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  buscarAlerta,
  marcarAlertaNotificado,
  registrarNotificacao,
  destinatariosJaNotificados,
} from "@/repositories/alertas";
import { destinatariosPara, buscarTenant } from "@/repositories/tenants";
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
 *
 * Quem já recebeu com sucesso numa tentativa anterior é pulado — sem isso, o retry
 * do BullMQ reenviaria WhatsApp duplicado pra quem já foi notificado. E ao contrário:
 * se sobrar QUALQUER destinatário sem sucesso (não só quando todos falham), a função
 * lança erro pra acionar o retry — antes, um alerta com 2 destinatários onde só 1
 * recebia era considerado "concluído" e o segundo nunca era renotificado nem alertado.
 */
export async function notificarAlerta(input: { tenantId: string; alertaId: string }): Promise<ResultadoNotificacao> {
  const alerta = await buscarAlerta(input.tenantId, input.alertaId);
  if (!alerta) throw new Error(`Alerta ${input.alertaId} não encontrado`);

  const [todosDestinatarios, jaNotificados, tenant] = await Promise.all([
    destinatariosPara(input.tenantId, alerta.severidade),
    destinatariosJaNotificados(alerta.id),
    buscarTenant(input.tenantId),
  ]);
  const fusoHorario = tenant?.fuso_horario ?? "America/Sao_Paulo";

  if (todosDestinatarios.length === 0) {
    logger.warn("alerta sem destinatário elegível", { tenantId: input.tenantId, alertaId: alerta.id });
    return { enviadas: 0, falhas: 0, latenciaMs: null, dentroDoSla: true };
  }

  const pendentes = todosDestinatarios.filter((d) => !jaNotificados.has(d.id));
  const jaEnviadosAntes = todosDestinatarios.length - pendentes.length;

  const urlAlerta = `${env().APP_BASE_URL}/alertas/${alerta.id}?t=${gerarTokenAlerta(alerta.id)}`;
  let enviadas = 0;
  let falhas = 0;
  let ultimoErro: unknown = null;

  for (const destinatario of pendentes) {
    try {
      const messageId = await enviarAlerta({
        telefoneE164: destinatario.telefone_e164,
        severidade: alerta.severidade,
        titulo: alerta.titulo,
        acaoRecomendada: alerta.acao_recomendada,
        detectadoEm: alerta.detectado_em,
        urlAlerta,
        fusoHorario,
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

  if (enviadas + jaEnviadosAntes > 0) {
    const latenciaMs = await marcarAlertaNotificado(alerta.id, new Date());
    const ok = latenciaMs === null || dentroDoSla(alerta.severidade, latenciaMs);
    if (!ok) {
      logger.warn("alerta crítico fora do SLA de 5 minutos", { alertaId: alerta.id, latenciaMs });
    }
    // Sobrou destinatário sem sucesso nesta tentativa: relança pra o BullMQ tentar de novo
    // só com quem falhou (quem já recebeu fica de fora do próximo retry, via jaNotificados).
    if (falhas > 0) {
      throw ultimoErro instanceof Error ? ultimoErro : new Error(`${falhas} destinatário(s) não notificado(s)`);
    }
    return { enviadas, falhas, latenciaMs, dentroDoSla: ok };
  }

  throw ultimoErro instanceof Error ? ultimoErro : new Error("Nenhuma notificação entregue");
}
