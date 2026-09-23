import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(1),

  INGEST_MAX_BATCH: z.coerce.number().int().positive().default(500),
  INGEST_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

  AZURE_TENANT_ID: z.string().default(""),
  AZURE_CLIENT_ID: z.string().default(""),
  AZURE_CLIENT_SECRET: z.string().default(""),

  AZURE_DCE_ENDPOINT: z.string().default(""),
  AZURE_DCR_IMMUTABLE_ID: z.string().default(""),
  AZURE_DCR_STREAM_NAME: z.string().default("Custom-CybergardLogs_CL"),

  AZURE_SUBSCRIPTION_ID: z.string().default(""),
  AZURE_RESOURCE_GROUP: z.string().default(""),
  AZURE_WORKSPACE_NAME: z.string().default(""),

  AZURE_ANOMALY_ENDPOINT: z.string().default(""),
  AZURE_ANOMALY_KEY: z.string().default(""),

  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_TEMPLATE_NAME: z.string().default("cybergard_alerta"),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("pt_BR"),
  // Verificação do webhook de status (GET) e validação de assinatura do payload (POST).
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_APP_SECRET: z.string().default(""),

  RAW_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  ALERT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  SENTINEL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ANOMALY_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  APP_BASE_URL: z.string().default("http://localhost:3000"),

  // Sobrescrito nos testes de integração para apontar Azure/Meta a um stub local.
  AZURE_LOGIN_ENDPOINT: z.string().default("https://login.microsoftonline.com"),
  AZURE_MANAGEMENT_ENDPOINT: z.string().default("https://management.azure.com"),
  WHATSAPP_GRAPH_ENDPOINT: z.string().default("https://graph.facebook.com"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}
