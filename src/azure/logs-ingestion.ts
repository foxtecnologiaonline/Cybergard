import { env } from "@/lib/env";
import { request } from "@/lib/http";
import { logger } from "@/lib/logger";
import { obterToken, SCOPE } from "./auth";
import type { EventoLog } from "@/domain/types";

/** Registro no formato do stream custom declarado no DCR. */
interface RegistroSentinel {
  TimeGenerated: string;
  TenantId: string;
  SourceId: string;
  EventType: string;
  Actor: string | null;
  SourceIp: string | null;
  Payload: string;
}

function paraRegistro(evento: EventoLog): RegistroSentinel {
  return {
    TimeGenerated: evento.ocorridoEm.toISOString(),
    TenantId: evento.tenantId,
    SourceId: evento.fonteId,
    EventType: evento.tipoEvento,
    Actor: evento.ator,
    SourceIp: evento.ipOrigem,
    Payload: JSON.stringify(evento.payload),
  };
}

/**
 * Envia eventos pro workspace do Sentinel via Logs Ingestion API (DCR).
 * A API aceita no máximo 1 MB por chamada, então o lote é quebrado antes de enviar.
 */
export async function enviarParaSentinel(eventos: EventoLog[]): Promise<void> {
  if (eventos.length === 0) return;

  const config = env();
  if (!config.AZURE_DCE_ENDPOINT || !config.AZURE_DCR_IMMUTABLE_ID) {
    throw new Error("Ingestão não configurada (AZURE_DCE_ENDPOINT/AZURE_DCR_IMMUTABLE_ID)");
  }

  const token = await obterToken(SCOPE.monitor);
  const url =
    `${config.AZURE_DCE_ENDPOINT}/dataCollectionRules/${config.AZURE_DCR_IMMUTABLE_ID}` +
    `/streams/${config.AZURE_DCR_STREAM_NAME}?api-version=2023-01-01`;

  for (const lote of dividirPorTamanho(eventos.map(paraRegistro), 900_000)) {
    await request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(lote),
      label: "azure.logs_ingestion",
    });
    logger.info("lote enviado ao Sentinel", { registros: lote.length });
  }
}

function* dividirPorTamanho(registros: RegistroSentinel[], limiteBytes: number): Generator<RegistroSentinel[]> {
  let atual: RegistroSentinel[] = [];
  let bytes = 2;

  for (const registro of registros) {
    const tamanho = Buffer.byteLength(JSON.stringify(registro)) + 1;
    if (atual.length > 0 && bytes + tamanho > limiteBytes) {
      yield atual;
      atual = [];
      bytes = 2;
    }
    atual.push(registro);
    bytes += tamanho;
  }

  if (atual.length > 0) yield atual;
}
