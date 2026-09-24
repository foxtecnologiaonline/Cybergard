import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
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

const statusSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  statuses: z
                    .array(
                      z.object({
                        id: z.string().min(1),
                        status: z.enum(["sent", "delivered", "read", "failed"]),
                        timestamp: z.string().regex(/^\d+$/),
                        errors: z.array(z.object({ title: z.string().optional() })).optional(),
                      }),
                    )
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

type StatusWebhook = z.infer<typeof statusSchema>;

const MAPA_STATUS: Record<string, "enviada" | "entregue" | "lida" | "falha"> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falha",
};

/**
 * Aplica os eventos de status do payload no registro de notificação correspondente (por message_id).
 * Um evento com formato inesperado (a Meta muda payload entre versões da API) é pulado e
 * logado, não derruba o processamento dos outros eventos do mesmo webhook.
 */
export async function processarStatusWebhook(payloadBruto: unknown): Promise<number> {
  const parsed = statusSchema.safeParse(payloadBruto);
  if (!parsed.success) {
    logger.warn("payload de webhook da Meta em formato inesperado", { erro: parsed.error.message });
    return 0;
  }

  const statuses =
    parsed.data.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.statuses ?? []) ?? [];

  let aplicados = 0;
  for (const evento of statuses) {
    const status = MAPA_STATUS[evento.status];
    if (!status) continue;

    try {
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
    } catch (error) {
      logger.error("falha ao aplicar status de um evento do webhook", {
        messageId: evento.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (aplicados > 0) logger.info("status de entrega atualizado", { recebidos: statuses.length, aplicados });
  return aplicados;
}
