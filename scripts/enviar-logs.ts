#!/usr/bin/env -S npx tsx
/**
 * Envia log pro Cybergard a partir de um arquivo NDJSON (um evento JSON por linha) ou de stdin.
 * Roda de forma independente — só precisa de Node, sem o resto do projeto instalado.
 *
 * Uso:
 *   npx tsx scripts/enviar-logs.ts --url https://app.seudominio.com/api/ingest --token SEU_TOKEN --file eventos.ndjson
 *   cat eventos.ndjson | npx tsx scripts/enviar-logs.ts --url ... --token ...
 *
 * Formato de cada linha (ver docs/integracao-fonte-log.md):
 *   {"ocorridoEm":"2026-09-23T14:30:00.000Z","tipoEvento":"login","ator":"ana@empresa.com","ipOrigem":"203.0.113.9","payload":{}}
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const TAMANHO_LOTE = 200;
const MAX_TENTATIVAS = 4;

function argumento(nome: string): string | undefined {
  const index = process.argv.indexOf(`--${nome}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function backoffMs(tentativa: number): number {
  return 1000 * 2 ** (tentativa - 1);
}

async function enviarLote(url: string, token: string, eventos: unknown[]): Promise<void> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ eventos }),
    });

    if (response.ok) {
      const corpo = (await response.json()) as { recebidos: number };
      console.log(`Lote enviado: ${corpo.recebidos} evento(s).`);
      return;
    }

    const corpoErro = await response.text().catch(() => "");
    const transitorio = response.status === 429 || response.status >= 500;
    if (!transitorio || tentativa === MAX_TENTATIVAS) {
      throw new Error(`Falha ao enviar lote (HTTP ${response.status}): ${corpoErro.slice(0, 300)}`);
    }
    console.warn(`Tentativa ${tentativa} falhou (HTTP ${response.status}), repetindo...`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs(tentativa)));
  }
}

async function* linhas(caminho: string | undefined): AsyncGenerator<string> {
  const entrada = caminho ? createReadStream(caminho, "utf8") : process.stdin;
  const rl = createInterface({ input: entrada, crlfDelay: Infinity });
  for await (const linha of rl) {
    if (linha.trim().length > 0) yield linha;
  }
}

async function main(): Promise<void> {
  const url = argumento("url");
  const token = argumento("token");
  const arquivo = argumento("file");

  if (!url || !token) {
    console.error("Uso: enviar-logs.ts --url <url-de-ingestao> --token <token-da-fonte> [--file eventos.ndjson]");
    process.exit(1);
  }

  let lote: unknown[] = [];
  let total = 0;
  let numeroLinha = 0;

  for await (const linha of linhas(arquivo)) {
    numeroLinha++;
    let evento: unknown;
    try {
      evento = JSON.parse(linha);
    } catch {
      console.error(`Linha ${numeroLinha} ignorada: JSON inválido.`);
      continue;
    }

    lote.push(evento);
    if (lote.length >= TAMANHO_LOTE) {
      await enviarLote(url, token, lote);
      total += lote.length;
      lote = [];
    }
  }

  if (lote.length > 0) {
    await enviarLote(url, token, lote);
    total += lote.length;
  }

  console.log(`Concluído: ${total} evento(s) enviado(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
