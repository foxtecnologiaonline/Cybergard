import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, verificarTokenSessao } from "@/lib/session";

/**
 * Rotas que não passam por autenticação de usuário:
 * - /api/ingest: autenticado por token de fonte de log (máquina a máquina).
 * - /api/webhooks/*: autenticado por assinatura da Meta.
 * - /api/health: sem dado sensível.
 * - /alertas/*: link enviado por WhatsApp, autenticado por token assinado na própria URL.
 * - /login, /api/auth/*: fluxo de autenticação.
 */
const PUBLICAS = [/^\/api\/ingest$/, /^\/api\/webhooks\//, /^\/api\/health$/, /^\/alertas\//, /^\/login$/, /^\/api\/auth\//];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // A verificação de sessão usa node:crypto (HMAC) — não roda no runtime Edge.
  runtime: "nodejs",
};

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (PUBLICAS.some((padrao) => padrao.test(pathname))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_SESSAO)?.value;
  const sessao = token ? verificarTokenSessao(token) : null;

  if (!sessao) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
    }
    const destino = new URL("/login", request.url);
    destino.searchParams.set("proximo", pathname);
    return NextResponse.redirect(destino);
  }

  // A rota em si relê e reverifica o cookie via obterSessao() — o middleware só barra o acesso.
  return NextResponse.next();
}
