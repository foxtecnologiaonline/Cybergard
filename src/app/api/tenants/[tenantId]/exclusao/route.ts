import { NextResponse } from "next/server";
import { solicitarExclusaoTenant } from "@/services/lgpd";
import { buscarTenant } from "@/repositories/tenants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Direito de esquecimento (LGPD): exclusão total dos dados do tenant em até 24h. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  const { tenantId } = await params;

  const tenant = await buscarTenant(tenantId);
  if (!tenant) return NextResponse.json({ erro: "tenant não encontrado" }, { status: 404 });

  const solicitadoPor = request.headers.get("x-usuario") ?? "nao_identificado";
  const excluirAte = await solicitarExclusaoTenant({ tenantId, solicitadoPor });

  return NextResponse.json({
    status: "em_exclusao",
    excluirAte: excluirAte.toISOString(),
    observacao: "Todos os dados do tenant serão apagados em até 24h.",
  });
}
