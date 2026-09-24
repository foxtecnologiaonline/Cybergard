import { env } from "@/lib/env";
import { requestJson } from "@/lib/http";
import { obterToken, SCOPE } from "./auth";

export type SeveridadeSentinel = "High" | "Medium" | "Low" | "Informational";

export interface IncidenteSentinel {
  id: string;
  numero: number;
  titulo: string;
  descricao: string;
  severidade: SeveridadeSentinel;
  status: string;
  criadoEm: Date;
  modificadoEm: Date;
  taticas: string[];
  urlPortal: string | null;
}

interface RespostaIncidentes {
  value: {
    id: string;
    name: string;
    properties: {
      incidentNumber: number;
      title: string;
      description?: string;
      severity: SeveridadeSentinel;
      status: string;
      createdTimeUtc: string;
      lastModifiedTimeUtc: string;
      firstActivityTimeUtc?: string;
      incidentUrl?: string;
      additionalData?: { tactics?: string[] };
    };
  }[];
  nextLink?: string;
}

function baseUrl(): string {
  const config = env();
  if (!config.AZURE_SUBSCRIPTION_ID || !config.AZURE_RESOURCE_GROUP || !config.AZURE_WORKSPACE_NAME) {
    throw new Error("Workspace do Sentinel não configurado (SUBSCRIPTION_ID/RESOURCE_GROUP/WORKSPACE_NAME)");
  }
  return (
    `${config.AZURE_MANAGEMENT_ENDPOINT}/subscriptions/${config.AZURE_SUBSCRIPTION_ID}` +
    `/resourceGroups/${config.AZURE_RESOURCE_GROUP}` +
    `/providers/Microsoft.OperationalInsights/workspaces/${config.AZURE_WORKSPACE_NAME}` +
    `/providers/Microsoft.SecurityInsights`
  );
}

/**
 * Lista incidentes modificados depois do cursor, do mais antigo pro mais novo.
 * Ordenar por lastModifiedTimeUtc é o que permite avançar o cursor sem pular incidente.
 *
 * Não segue `nextLink`: se mais de `limite` incidentes forem modificados no mesmo
 * ciclo de poll, o excedente só é lido no próximo poll (o cursor não pula, apenas
 * atrasa). Para o volume esperado do piloto isso é inofensivo; se um tenant crescer
 * a ponto de gerar dezenas de incidentes por minuto, paginar aqui vira prioridade.
 */
export async function listarIncidentes(desde: Date | null, limite = 50): Promise<IncidenteSentinel[]> {
  const token = await obterToken(SCOPE.management);
  const params = new URLSearchParams({
    "api-version": "2023-02-01",
    $orderby: "properties/lastModifiedTimeUtc asc",
    $top: String(limite),
  });
  if (desde) {
    params.set("$filter", `properties/lastModifiedTimeUtc gt ${desde.toISOString()}`);
  }

  const resposta = await requestJson<RespostaIncidentes>(`${baseUrl()}/incidents?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    label: "azure.sentinel_incidents",
  });

  return resposta.value.map((item) => ({
    id: item.name,
    numero: item.properties.incidentNumber,
    titulo: item.properties.title,
    descricao: item.properties.description ?? "",
    severidade: item.properties.severity,
    status: item.properties.status,
    criadoEm: new Date(item.properties.firstActivityTimeUtc ?? item.properties.createdTimeUtc),
    modificadoEm: new Date(item.properties.lastModifiedTimeUtc),
    taticas: item.properties.additionalData?.tactics ?? [],
    urlPortal: item.properties.incidentUrl ?? null,
  }));
}
