type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Campos que nunca podem sair em log — LGPD e segredo de tenant.
const REDACTED_KEYS = new Set([
  "access_token",
  "accessToken",
  "client_secret",
  "clientSecret",
  "authorization",
  "apiKey",
  "api_key",
  "password",
  "phone",
  "phoneE164",
  "email",
  "credentials",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED_KEYS.has(k) ? "[redigido]" : redact(v, depth + 1);
  }
  return out;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const min = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? order.info;
  if (order[level] < min) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  });
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => emit("debug", m, c),
  info: (m: string, c?: Record<string, unknown>) => emit("info", m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit("warn", m, c),
  error: (m: string, c?: Record<string, unknown>) => emit("error", m, c),
};
