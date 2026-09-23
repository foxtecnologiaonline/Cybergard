import { NextResponse } from "next/server";
import { z } from "zod";
import { criarFonteLog, listarFontes } from "@/repositories/fontes-log";
import { registrarAuditoria } from "@/repositories/tenants";
import { obterSessao } from "@/lib/session";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const criarSchema = z.object({
  tipo: z.enum(["painel_admin", "email_corporativo", "webhook_generico"]),
  nome: z.string().min(1).max(120),
  credenciais: z.record(z.string()).optional(),
});

export async function GET(): Promise<NextResponse> {
  const sessao = await obterSessao();
  if (!sessao) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  return NextResponse.json({ fontes: await listarFontes(sessao.tenantId) });
}

/** Conecta uma fonte de log do tenant logado. O token de ingestão é devolvido uma única vez. */
export async function POST(request: Request): Promise<NextResponse> {
  const sessao = await obterSessao();
  if (!sessao) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const parsed = criarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "dados inválidos", detalhes: parsed.error.flatten() }, { status: 422 });
  }

  const { fonte, tokenIngest } = await criarFonteLog({
    tenantId: sessao.tenantId,
    tipo: parsed.data.tipo,
    nome: parsed.data.nome,
    credenciais: parsed.data.credenciais ?? null,
  });

  await registrarAuditoria({
    tenantId: sessao.tenantId,
    acao: "onboarding.fonte_conectada",
    ator: sessao.usuarioId,
    detalhes: { fonteId: fonte.id, tipo: fonte.tipo },
  });

  return NextResponse.json(
    {
      fonte,
      tokenIngest,
      urlIngestao: `${env().APP_BASE_URL}/api/ingest`,
      observacao: "Guarde o token agora: ele não é exibido novamente.",
    },
    { status: 201 },
  );
}
