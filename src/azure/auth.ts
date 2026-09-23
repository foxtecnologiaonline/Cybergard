import { env } from "@/lib/env";
import { requestJson } from "@/lib/http";

/** Escopos usados pelo Cybergard. Cada API da Azure exige um audience diferente. */
export const SCOPE = {
  /** Logs Ingestion API (envio de log pro workspace via DCR). */
  monitor: "https://monitor.azure.com/.default",
  /** Azure Resource Manager — leitura de incidentes do Sentinel. */
  management: "https://management.azure.com/.default",
} as const;

export type Scope = (typeof SCOPE)[keyof typeof SCOPE];

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface CachedToken {
  token: string;
  expiraEm: number;
}

const cache = new Map<string, CachedToken>();

/** Margem de segurança: renova antes de expirar pra não perder chamada na virada. */
const SKEW_MS = 60_000;

export async function obterToken(scope: Scope): Promise<string> {
  const cached = cache.get(scope);
  if (cached && cached.expiraEm > Date.now() + SKEW_MS) return cached.token;

  const config = env();
  if (!config.AZURE_TENANT_ID || !config.AZURE_CLIENT_ID || !config.AZURE_CLIENT_SECRET) {
    throw new Error("Credenciais do Azure AD ausentes (AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET)");
  }

  const body = new URLSearchParams({
    client_id: config.AZURE_CLIENT_ID,
    client_secret: config.AZURE_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope,
  });

  const response = await requestJson<TokenResponse>(
    `${config.AZURE_LOGIN_ENDPOINT}/${config.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      label: "azure.token",
    },
  );

  cache.set(scope, {
    token: response.access_token,
    expiraEm: Date.now() + response.expires_in * 1000,
  });
  return response.access_token;
}

export function limparCacheDeToken(): void {
  cache.clear();
}
