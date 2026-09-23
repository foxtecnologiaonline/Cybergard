import { NextResponse } from "next/server";
import { solicitarExclusaoTenant } from "@/services/lgpd";
import { obterSessao } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Direito de esquecimento (LGPD): exclusão total dos dados do tenant em até 24h. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  const sessao = await obterSessao();
  if (!sessao) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { tenantId } = await params;
  // Um usuário só pode solicitar a exclusão do próprio tenant, e só admin dispara ação irreversível.
  if (tenantId !== sessao.tenantId) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 403 });
  }
  if (sessao.papel !== "admin") {
    return NextResponse.json({ erro: "apenas administrador pode solicitar exclusão" }, { status: 403 });
  }

  const excluirAte = await solicitarExclusaoTenant({ tenantId, solicitadoPor: sessao.usuarioId });

  return NextResponse.json({
    status: "em_exclusao",
    excluirAte: excluirAte.toISOString(),
    observacao: "Todos os dados do tenant serão apagados em até 24h.",
  });
}
