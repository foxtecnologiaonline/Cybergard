import { cookies } from "next/headers";
import { assinarHmac, verificarHmac } from "./crypto";

export const COOKIE_SESSAO = "cybergard_sessao";
const DURACAO_MS = 7 * 24 * 60 * 60 * 1000;

export interface Sessao {
  usuarioId: string;
  tenantId: string;
  papel: "admin" | "membro";
  expiraEm: number;
}

/** Token estável e verificável sem consulta ao banco: base64url(payload).assinatura. */
export function criarTokenSessao(input: { usuarioId: string; tenantId: string; papel: "admin" | "membro" }): string {
  const payload: Sessao = { ...input, expiraEm: Date.now() + DURACAO_MS };
  const codificado = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${codificado}.${assinarHmac(codificado)}`;
}

export function verificarTokenSessao(token: string): Sessao | null {
  const [codificado, assinatura] = token.split(".");
  if (!codificado || !assinatura) return null;
  if (!verificarHmac(codificado, assinatura)) return null;

  try {
    const payload = JSON.parse(Buffer.from(codificado, "base64url").toString("utf8")) as Sessao;
    if (typeof payload.expiraEm !== "number" || payload.expiraEm < Date.now()) return null;
    if (!payload.usuarioId || !payload.tenantId) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Lê a sessão em Server Component ou Route Handler. O middleware já garantiu que é válida nas rotas protegidas. */
export async function obterSessao(): Promise<Sessao | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_SESSAO)?.value;
  if (!token) return null;
  return verificarTokenSessao(token);
}

export function opcoesCookieSessao() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURACAO_MS / 1000,
  };
}
