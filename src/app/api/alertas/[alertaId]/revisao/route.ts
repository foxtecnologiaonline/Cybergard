import { NextResponse } from "next/server";
import { z } from "zod";
import { marcarFalsoPositivo } from "@/repositories/alertas";
import { registrarAuditoria } from "@/repositories/tenants";
import { obterSessao } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  falsoPositivo: z.boolean(),
});

/** Marcação de falso positivo — alimenta a taxa revisada mensalmente com o piloto. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ alertaId: string }> },
): Promise<NextResponse> {
  const sessao = await obterSessao();
  if (!sessao) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { alertaId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "dados inválidos", detalhes: parsed.error.flatten() }, { status: 422 });
  }

  await marcarFalsoPositivo({
    tenantId: sessao.tenantId,
    alertaId,
    falsoPositivo: parsed.data.falsoPositivo,
    revisadoPor: sessao.usuarioId,
  });
  await registrarAuditoria({
    tenantId: sessao.tenantId,
    acao: "alerta.revisado",
    ator: sessao.usuarioId,
    detalhes: { alertaId, falsoPositivo: parsed.data.falsoPositivo },
  });

  return NextResponse.json({ status: "revisado" });
}
