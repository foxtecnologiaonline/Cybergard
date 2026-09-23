import { randomBytes } from "node:crypto";
import { iniciarStub, type Stub } from "./stub-azure";

/**
 * Aponta toda integração externa para o stub local e devolve o controle dele.
 * Precisa rodar antes de qualquer import que leia env(), por isso o chamador usa import dinâmico.
 */
export async function prepararAmbiente(): Promise<Stub> {
  const stub = await iniciarStub();

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://cybergard:cybergard@127.0.0.1:5432/cybergard";
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = randomBytes(32).toString("base64");
  process.env.LOG_LEVEL = "error";

  process.env.AZURE_LOGIN_ENDPOINT = stub.baseUrl;
  process.env.AZURE_MANAGEMENT_ENDPOINT = stub.baseUrl;
  process.env.WHATSAPP_GRAPH_ENDPOINT = stub.baseUrl;

  process.env.AZURE_TENANT_ID = "tenant-teste";
  process.env.AZURE_CLIENT_ID = "client-teste";
  process.env.AZURE_CLIENT_SECRET = "segredo-teste";

  process.env.AZURE_DCE_ENDPOINT = stub.baseUrl;
  process.env.AZURE_DCR_IMMUTABLE_ID = "dcr-teste";
  process.env.AZURE_DCR_STREAM_NAME = "Custom-CybergardLogs_CL";

  process.env.AZURE_SUBSCRIPTION_ID = "sub-teste";
  process.env.AZURE_RESOURCE_GROUP = "rg-teste";
  process.env.AZURE_WORKSPACE_NAME = "ws-teste";

  process.env.AZURE_ANOMALY_ENDPOINT = stub.baseUrl;
  process.env.AZURE_ANOMALY_KEY = "chave-teste";

  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
  process.env.WHATSAPP_ACCESS_TOKEN = "token-meta-teste";
  process.env.WHATSAPP_APP_SECRET = "segredo-app-teste";
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-teste";
  process.env.APP_BASE_URL = "http://localhost:3000";

  return stub;
}
