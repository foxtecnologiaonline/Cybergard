import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { verificarAssinaturaMeta, processarStatusWebhook } from "@/whatsapp/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Handshake de verificação exigido pela Meta ao cadastrar a URL do webhook. */
export function GET(request: Request): NextResponse {
  const params = new URL(request.url).searchParams;
  const modo = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (modo === "subscribe" && token === env().WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ erro: "verificação falhou" }, { status: 403 });
}

/** Recebe status de entrega (sent/delivered/read/failed) dos alertas enviados. */
export async function POST(request: Request): Promise<NextResponse> {
  const corpoRaw = await request.text();

  if (!verificarAssinaturaMeta(corpoRaw, request.headers.get("x-hub-signature-256"))) {
    logger.warn("webhook da Meta com assinatura inválida");
    return NextResponse.json({ erro: "assinatura inválida" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(corpoRaw);
  } catch {
    return NextResponse.json({ erro: "JSON inválido" }, { status: 400 });
  }

  await processarStatusWebhook(payload as Parameters<typeof processarStatusWebhook>[0]);
  // A Meta reenvia em retry se não receber 200 rápido — confirmar mesmo se algum id não bateu.
  return NextResponse.json({ status: "ok" });
}
