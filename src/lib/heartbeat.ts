import { redis } from "./redis";

const CHAVE = "cybergard:worker:heartbeat";

export async function registrarPulso(): Promise<void> {
  await redis().set(CHAVE, Date.now().toString());
}

export interface StatusWorker {
  vivo: boolean;
  ultimoPulsoHaMs: number | null;
}

/** O worker é considerado vivo se pulsou dentro de 3x o intervalo esperado — tolera um atraso, não um sumiço. */
export async function statusWorker(intervaloEsperadoMs: number): Promise<StatusWorker> {
  const valor = await redis().get(CHAVE);
  if (!valor) return { vivo: false, ultimoPulsoHaMs: null };

  const haMs = Date.now() - Number(valor);
  return { vivo: haMs < intervaloEsperadoMs * 3, ultimoPulsoHaMs: haMs };
}
