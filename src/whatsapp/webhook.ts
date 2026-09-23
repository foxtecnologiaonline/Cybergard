import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { query } from "@/lib/db";
import { logger } from "@/lib/logger";

export function verificarAssinaturaMeta(corpoRaw: string, assinaturaHeader: string | null): boolean {
  const segredo = env().WHATSAPP_APP_SECRET;
  if (!segredo || !assinaturaHeader?.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", segredo).update(corpoRaw).digest("hex");
  const recebida = assinaturaHeader.slice("sha256=".length);

  const bufEsperada = Buffer.from(esperada, "hex");
  const bufRecebida = Buffer.from(recebida, "hex");
  if (bufEsperada.length !== bufRecebida.length) return false;
  return timingSafeEqual(bufEsperada, bufRecebida);
}

interface StatusWebhook {
  entry?: {
    changes?: {
      value?: {
        statuses?: {
          id: string;
          status: "sent" | "delivered" | "read" | "failed";
          timestamp: string;
          errors?: { title?: string }[];
        }[];
      };
    }[];
  }[];
}

const MAPA_STATUS: Record<string, "enviada" | "entregue" | "lida" | "falha"> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falha",
};

/** Aplica os eventos de status do payload no registro de notificação correspondente (por message_id). */
export async function processarStatusWebhook(payload: StatusWebhook): Promise<number> {
  const statuses = payload.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.statuses ?? []) ?? [];

  let aplicados = 0;
  for (const evento of statuses) {
    const status = MAPA_STATUS[evento.status];
    if (!status) continue;

    const quando = new Date(Number(evento.timestamp) * 1000);
    const erro = evento.errors?.[0]?.title ?? null;

    const resultado = await query(
      `UPDATE notificacoes
          SET status = $2,
              entregue_em = CASE WHEN $2 IN ('entregue', 'lida') THEN COALESCE(entregue_em, $3) ELSE entregue_em END,
              lida_em = CASE WHEN $2 = 'lida' THEN COALESCE(lida_em, $3) ELSE lida_em END,
              erro = COALESCE($4, erro)
        WHERE message_id = $1
        RETURNING id`,
      [evento.id, status, quando, erro],
    );
    if (resultado.length > 0) aplicados++;
  }

  if (aplicados > 0) logger.info("status de entrega atualizado", { recebidos: statuses.length, aplicados });
  return aplicados;
}
