import { assinarHmac, verificarHmac } from "./crypto";

/**
 * Token do link enviado por WhatsApp: dá acesso de leitura a um único alerta,
 * sem exigir login no celular. Curta duração — depois disso a pessoa precisa entrar no painel.
 */
const DURACAO_MS = 14 * 24 * 60 * 60 * 1000;

export function gerarTokenAlerta(alertaId: string): string {
  const expiraEm = Date.now() + DURACAO_MS;
  const payload = `${alertaId}.${expiraEm}`;
  return `${Buffer.from(payload).toString("base64url")}.${assinarHmac(payload)}`;
}

export function verificarTokenAlerta(alertaId: string, token: string | null): boolean {
  if (!token) return false;
  const [codificado, assinatura] = token.split(".");
  if (!codificado || !assinatura) return false;

  const payload = Buffer.from(codificado, "base64url").toString("utf8");
  if (!verificarHmac(payload, assinatura)) return false;

  const [idNoToken, expiraEmStr] = payload.split(".");
  if (idNoToken !== alertaId) return false;
  const expiraEm = Number(expiraEmStr);
  return Number.isFinite(expiraEm) && expiraEm > Date.now();
}
