import { NextResponse } from "next/server";
import { ingerirLote, loteSchema, LoteMuitoGrandeError } from "@/services/ingestao";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entrada de log das fontes conectadas. Autenticação é por token de fonte (Bearer). */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) {
    return NextResponse.json({ erro: "token de ingestão ausente" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "JSON inválido" }, { status: 400 });
  }

  const parsed = loteSchema.safeParse(corpo);
  if (!parsed.success) {
    return NextResponse.json({ erro: "lote inválido", detalhes: parsed.error.flatten() }, { status: 422 });
  }

  try {
    const resultado = await ingerirLote({ token, eventos: parsed.data.eventos });
    return NextResponse.json({
      recebidos: resultado.persistidos,
      encaminhadosAoSentinel: resultado.encaminhados,
    });
  } catch (error) {
    if (error instanceof LoteMuitoGrandeError) {
      return NextResponse.json({ erro: error.message }, { status: 413 });
    }
    const mensagem = error instanceof Error ? error.message : String(error);
    if (mensagem.includes("Token de ingestão inválido")) {
      return NextResponse.json({ erro: "token de ingestão inválido" }, { status: 401 });
    }
    logger.error("falha na ingestão", { error: mensagem });
    return NextResponse.json({ erro: "falha ao processar lote" }, { status: 500 });
  }
}
