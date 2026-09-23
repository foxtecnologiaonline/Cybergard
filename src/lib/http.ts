import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} em ${url}`);
    this.name = "HttpError";
  }

  /** 408/429 e 5xx são transitórios; o resto é erro de contrato e não adianta repetir. */
  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  attempts?: number;
  /** Rótulo usado no log estruturado — identifica a integração, não a URL completa. */
  label: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 4;

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Requisição com timeout, retry exponencial e log estruturado. Toda chamada externa passa por aqui. */
export async function request(url: string, options: RequestOptions): Promise<Response> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = new HttpError(response.status, text.slice(0, 500), url);
        if (!error.retryable || attempt === attempts) throw error;
        logger.warn("chamada externa falhou, repetindo", {
          label: options.label,
          status: response.status,
          attempt,
          durationMs: Date.now() - startedAt,
        });
        lastError = error;
        await sleep(backoffMs(attempt));
        continue;
      }

      logger.debug("chamada externa ok", {
        label: options.label,
        status: response.status,
        attempt,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastError = error;
      if (attempt === attempts) break;
      logger.warn("chamada externa com erro de rede, repetindo", {
        label: options.label,
        attempt,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Falha em ${options.label}`);
}

export async function requestJson<T>(url: string, options: RequestOptions): Promise<T> {
  const response = await request(url, options);
  return (await response.json()) as T;
}
