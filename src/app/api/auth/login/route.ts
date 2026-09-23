import { NextResponse } from "next/server";
import { z } from "zod";
import { buscarUsuarioParaLogin, registrarLogin } from "@/repositories/usuarios";
import { verificarSenha } from "@/lib/crypto";
import { criarTokenSessao, opcoesCookieSessao, COOKIE_SESSAO } from "@/lib/session";
import { registrarAuditoria } from "@/repositories/tenants";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

// Atraso fixo em credencial inválida — não dá pra distinguir "e-mail não existe" de "senha errada" pelo tempo de resposta.
const ATRASO_FALHA_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "e-mail e senha são obrigatórios" }, { status: 422 });
  }

  const usuario = await buscarUsuarioParaLogin(parsed.data.email);
  const senhaOk = usuario ? verificarSenha(parsed.data.senha, usuario.senha_hash) : false;

  if (!usuario || !senhaOk) {
    await sleep(ATRASO_FALHA_MS);
    return NextResponse.json({ erro: "e-mail ou senha inválidos" }, { status: 401 });
  }

  await registrarLogin(usuario.id);
  await registrarAuditoria({
    tenantId: usuario.tenant_id,
    acao: "auth.login",
    ator: usuario.email,
    detalhes: {},
  });
  logger.info("login realizado", { usuarioId: usuario.id, tenantId: usuario.tenant_id });

  const token = criarTokenSessao({ usuarioId: usuario.id, tenantId: usuario.tenant_id, papel: usuario.papel });
  const response = NextResponse.json({ status: "ok" });
  response.cookies.set(COOKIE_SESSAO, token, opcoesCookieSessao());
  return response;
}
