import IORedis, { type Redis } from "ioredis";
import { env } from "./env";

let connection: Redis | null = null;
const conexoesDedicadas: Redis[] = [];

/**
 * Conexão compartilhada, para comando request/response simples (Queue.add, rate limit,
 * heartbeat, health check). Nunca passar isto para um BullMQ Worker.
 */
export function redis(): Redis {
  if (!connection) {
    connection = new IORedis(env().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

/**
 * Conexão dedicada e nova a cada chamada — obrigatória para BullMQ Worker.
 * Worker usa comando bloqueante (BZPOPMIN) pra puxar job da fila; compartilhar essa
 * conexão com uma Queue ou outro Worker faz o Redis "roubar" resposta entre clientes
 * — o sintoma é sutil (ex.: prioridade de fila que às vezes não é respeitada), não um erro
 * explícito. O BullMQ documenta isso; nunca reusar redis() aqui.
 */
export function criarConexaoWorker(): Redis {
  const conexao = new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  conexoesDedicadas.push(conexao);
  return conexao;
}

async function fecharComSeguranca(c: Redis): Promise<void> {
  // "end"/"close" = já desconectada (ex.: alguém deu quit manual antes) — quit() de novo rejeita.
  if (c.status === "end" || c.status === "close") return;
  await c.quit();
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    await fecharComSeguranca(connection);
    connection = null;
  }
  await Promise.all(conexoesDedicadas.splice(0).map(fecharComSeguranca));
}
