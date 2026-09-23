import IORedis, { type Redis } from "ioredis";
import { env } from "./env";

let connection: Redis | null = null;

export function redis(): Redis {
  if (!connection) {
    connection = new IORedis(env().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
