import { redis } from "./redis";

/**
 * Janela fixa por chave: INCR + EXPIRE no primeiro hit. Simples e suficiente pra
 * limitar uma fonte de log com defeito — não precisa da precisão de uma janela deslizante.
 */
export async function limiteExcedido(chave: string, limite: number, janelaSegundos = 60): Promise<boolean> {
  const key = `rate-limit:${chave}`;
  const contagem = await redis().incr(key);
  if (contagem === 1) {
    await redis().expire(key, janelaSegundos);
  }
  return contagem > limite;
}
