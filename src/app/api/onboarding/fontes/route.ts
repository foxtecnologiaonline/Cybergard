import { NextResponse } from "next/server";
import { z } from "zod";
import { criarFonteLog, listarFontes } from "@/repositories/fontes-log";
import { buscarTenant, registrarAuditoria } from "@/repositories/tenants";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const criarSchema = z.object({
  tenantId: z.string().uuid(),
  tipo: z.enum(["painel_admin", "email_corporativo", "webhook_generico"]),
  nome: z.string().min(1).max(120),
  credenciais: z.record(z.string()).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ erro: "tenantId obrigatório" }, { status: 400 });
  return NextResponse.json({ fontes: await listarFontes(tenantId) });
}

/** Conecta uma fonte de log do tenant. O token de ingestão é devolvido uma única vez. */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = criarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "dados inválidos", detalhes: parsed.error.flatten() }, { status: 422 });
  }

  const tenant = await buscarTenant(parsed.data.tenantId);
  if (!tenant) return NextResponse.json({ erro: "tenant não encontrado" }, { status: 404 });

  const { fonte, tokenIngest } = await criarFonteLog({
    tenantId: parsed.data.tenantId,
    tipo: parsed.data.tipo,
    nome: parsed.data.nome,
    credenciais: parsed.data.credenciais ?? null,
  });

  await registrarAuditoria({
    tenantId: parsed.data.tenantId,
    acao: "onboarding.fonte_conectada",
    ator: request.headers.get("x-usuario") ?? "nao_identificado",
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
