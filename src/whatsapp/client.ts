import { env } from "@/lib/env";
import { requestJson } from "@/lib/http";
import type { Severidade } from "@/domain/types";

const ROTULO: Record<Severidade, string> = {
  critico: "CRÍTICO",
  atencao: "ATENÇÃO",
  informativo: "INFORMATIVO",
};

export interface MensagemAlerta {
  telefoneE164: string;
  severidade: Severidade;
  titulo: string;
  acaoRecomendada: string;
  detectadoEm: Date;
  urlAlerta: string;
}

interface RespostaEnvio {
  messages?: { id: string }[];
}

/**
 * Parâmetros do template aprovado na Meta (v1: `cybergard_alerta`).
 * Alerta é mensagem iniciada pela empresa, então fora da janela de 24h só template passa.
 */
export function parametrosTemplate(mensagem: MensagemAlerta): string[] {
  const horario = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(mensagem.detectadoEm);

  return [
    ROTULO[mensagem.severidade],
    mensagem.titulo.slice(0, 120),
    horario,
    mensagem.acaoRecomendada.slice(0, 300),
    mensagem.urlAlerta,
  ];
}

export async function enviarAlerta(mensagem: MensagemAlerta): Promise<string> {
  const config = env();
  if (!config.WHATSAPP_PHONE_NUMBER_ID || !config.WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WhatsApp não configurado (WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN)");
  }

  const resposta = await requestJson<RespostaEnvio>(
    `${config.WHATSAPP_GRAPH_ENDPOINT}/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: mensagem.telefoneE164,
        type: "template",
        template: {
          name: config.WHATSAPP_TEMPLATE_NAME,
          language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE },
          components: [
            {
              type: "body",
              parameters: parametrosTemplate(mensagem).map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
      label: "whatsapp.send",
      // Alerta crítico não pode ficar preso em retry longo; falha rápida e a fila reagenda.
      timeoutMs: 10_000,
      attempts: 3,
    },
  );

  const id = resposta.messages?.[0]?.id;
  if (!id) throw new Error("Meta não retornou message id");
  return id;
}

/** Normaliza telefone brasileiro para E.164 sem o "+" (formato aceito pela Cloud API). */
export function normalizarTelefone(entrada: string): string {
  const digitos = entrada.replace(/\D/g, "");
  if (digitos.length === 0) throw new Error("Telefone vazio");
  if (digitos.startsWith("55")) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}
