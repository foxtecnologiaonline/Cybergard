import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubState {
  /** Incidentes que o "Sentinel" devolve no próximo poll. */
  incidentes: unknown[];
  /** Resposta do "Anomaly Detector". */
  anomalia: Record<string, unknown>;
  /** Mensagens que o "WhatsApp" recebeu, com o instante de chegada. */
  mensagensWhatsapp: { body: Record<string, unknown>; recebidaEm: number }[];
  /** Lotes entregues na Logs Ingestion API. */
  lotesIngestao: unknown[][];
  /** Força falha temporária no envio do WhatsApp, para exercitar o retry. */
  falharWhatsappVezes: number;
}

export interface Stub {
  server: Server;
  baseUrl: string;
  state: StubState;
  fechar: () => Promise<void>;
}

async function lerJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Sobe um servidor local que responde como Azure AD, Sentinel, Anomaly Detector e Meta Cloud API. */
export async function iniciarStub(): Promise<Stub> {
  const state: StubState = {
    incidentes: [],
    anomalia: {
      isAnomaly: false,
      isPositiveAnomaly: false,
      isNegativeAnomaly: false,
      severity: 0,
      expectedValue: 0,
      upperMargin: 0,
      lowerMargin: 0,
    },
    mensagensWhatsapp: [],
    lotesIngestao: [],
    falharWhatsappVezes: 0,
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const responder = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      // Azure AD — client credentials.
      if (url.pathname.endsWith("/oauth2/v2.0/token")) {
        await lerJson(req);
        return responder(200, { access_token: "token-de-teste", expires_in: 3600 });
      }

      // Logs Ingestion API (DCR).
      if (url.pathname.includes("/dataCollectionRules/")) {
        const body = await lerJson(req);
        state.lotesIngestao.push(body as unknown[]);
        res.writeHead(204).end();
        return;
      }

      // Sentinel — lista de incidentes.
      if (url.pathname.endsWith("/incidents")) {
        return responder(200, { value: state.incidentes });
      }

      // Azure AI Anomaly Detector.
      if (url.pathname.includes("/anomalydetector/")) {
        await lerJson(req);
        return responder(200, state.anomalia);
      }

      // Meta Cloud API — envio de mensagem.
      if (url.pathname.endsWith("/messages")) {
        const body = (await lerJson(req)) as Record<string, unknown>;
        if (state.falharWhatsappVezes > 0) {
          state.falharWhatsappVezes--;
          return responder(503, { error: { message: "indisponível" } });
        }
        state.mensagensWhatsapp.push({ body, recebidaEm: Date.now() });
        return responder(200, { messages: [{ id: `wamid.${state.mensagensWhatsapp.length}` }] });
      }

      responder(404, { erro: "rota não stubada", path: url.pathname });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    fechar: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
