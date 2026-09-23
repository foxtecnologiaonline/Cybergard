import { env } from "@/lib/env";
import { requestJson } from "@/lib/http";

export interface PontoSerie {
  timestamp: Date;
  value: number;
}

export interface ResultadoAnomalia {
  isAnomaly: boolean;
  isPositiveAnomaly: boolean;
  isNegativeAnomaly: boolean;
  /** 0..1 — quanto mais alto, mais o ponto destoa da série. */
  severity: number;
  expectedValue: number;
  upperMargin: number;
  lowerMargin: number;
}

interface RespostaAnomalia {
  isAnomaly: boolean;
  isPositiveAnomaly: boolean;
  isNegativeAnomaly: boolean;
  severity?: number;
  expectedValue: number;
  upperMargin: number;
  lowerMargin: number;
}

/** O serviço exige no mínimo 12 pontos para modelar a série. */
export const MINIMO_DE_PONTOS = 12;

/**
 * Detecta se o último ponto da série é anômalo (Azure AI Anomaly Detector, modo "last").
 * Usado para padrão de acesso: volume de login, de requisição e de falha de login.
 */
export async function detectarUltimoPonto(input: {
  serie: PontoSerie[];
  granularity?: "hourly" | "daily" | "minutely";
  /** 0..99: quanto maior, menos pontos viram anomalia. */
  sensitivity?: number;
}): Promise<ResultadoAnomalia | null> {
  if (input.serie.length < MINIMO_DE_PONTOS) return null;

  const config = env();
  if (!config.AZURE_ANOMALY_ENDPOINT || !config.AZURE_ANOMALY_KEY) {
    throw new Error("Anomaly Detector não configurado (AZURE_ANOMALY_ENDPOINT/AZURE_ANOMALY_KEY)");
  }

  const resposta = await requestJson<RespostaAnomalia>(
    `${config.AZURE_ANOMALY_ENDPOINT}/anomalydetector/v1.1/timeseries/last/detect`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ocp-apim-subscription-key": config.AZURE_ANOMALY_KEY,
      },
      body: JSON.stringify({
        series: input.serie.map((p) => ({ timestamp: p.timestamp.toISOString(), value: p.value })),
        granularity: input.granularity ?? "hourly",
        sensitivity: input.sensitivity ?? 85,
      }),
      label: "azure.anomaly_detector",
    },
  );

  return {
    isAnomaly: resposta.isAnomaly,
    isPositiveAnomaly: resposta.isPositiveAnomaly,
    isNegativeAnomaly: resposta.isNegativeAnomaly,
    severity: resposta.severity ?? 0,
    expectedValue: resposta.expectedValue,
    upperMargin: resposta.upperMargin,
    lowerMargin: resposta.lowerMargin,
  };
}
