import { NextResponse } from "next/server";
import { z } from "zod";
import { marcarFalsoPositivo } from "@/repositories/alertas";
import { registrarAuditoria } from "@/repositories/tenants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  tenantId: z.string().uuid(),
  falsoPositivo: z.boolean(),
});

/** Marcação de falso positivo — alimenta a taxa revisada mensalmente com o piloto. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ alertaId: string }> },
): Promise<NextResponse> {
  const { alertaId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "dados inválidos", detalhes: parsed.error.flatten() }, { status: 422 });
  }

  const revisadoPor = request.headers.get("x-usuario") ?? "nao_identificado";
  await marcarFalsoPositivo({
    tenantId: parsed.data.tenantId,
    alertaId,
    falsoPositivo: parsed.data.falsoPositivo,
    revisadoPor,
  });
  await registrarAuditoria({
    tenantId: parsed.data.tenantId,
    acao: "alerta.revisado",
    ator: revisadoPor,
    detalhes: { alertaId, falsoPositivo: parsed.data.falsoPositivo },
  });

  return NextResponse.json({ status: "revisado" });
}
