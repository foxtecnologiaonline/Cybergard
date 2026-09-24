import { redis } from "./redis";

/**
 * Janela fixa por chave: INCR + EXPIRE NX. O NX (só expira se a chave ainda não tiver TTL)
 * é o que torna isto auto-recuperável: se o processo cair entre o INCR e o EXPIRE, a
 * próxima chamada corrige o TTL em vez de deixar a chave presa sem expirar (o que travaria
 * a fonte de log em rate limit pra sempre). Exige Redis 7+ (já é o que o docker-compose usa).
 */
export async function limiteExcedido(chave: string, limite: number, janelaSegundos = 60): Promise<boolean> {
  const key = `rate-limit:${chave}`;
  const contagem = await redis().incr(key);
  await redis().expire(key, janelaSegundos, "NX");
  return contagem > limite;
}
