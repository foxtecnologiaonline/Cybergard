import { describe, it, expect, beforeAll } from "vitest";
import { parametrosTemplate, normalizarTelefone } from "@/whatsapp/client";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.CREDENTIALS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
});

describe("mensagem de alerta no WhatsApp", () => {
  it("monta os cinco parâmetros do template na ordem esperada", () => {
    const params = parametrosTemplate({
      telefoneE164: "5511999999999",
      severidade: "critico",
      titulo: "Pico de tentativas de login malsucedidas",
      acaoRecomendada: "Troque a senha das contas de administrador.",
      detectadoEm: new Date("2026-09-22T15:30:00Z"),
      urlAlerta: "https://app.cybergard.com.br/alertas/abc",
    });

    expect(params).toHaveLength(5);
    expect(params[0]).toBe("CRÍTICO");
    expect(params[1]).toBe("Pico de tentativas de login malsucedidas");
    expect(params[4]).toContain("/alertas/abc");
  });

  it("trunca título e ação para caber nos limites do template", () => {
    const params = parametrosTemplate({
      telefoneE164: "5511999999999",
      severidade: "atencao",
      titulo: "t".repeat(400),
      acaoRecomendada: "a".repeat(900),
      detectadoEm: new Date(),
      urlAlerta: "https://x/y",
    });
    expect(params[1]!.length).toBe(120);
    expect(params[3]!.length).toBe(300);
  });
});

describe("normalização de telefone", () => {
  it("acrescenta DDI do Brasil quando falta", () => {
    expect(normalizarTelefone("(11) 99999-9999")).toBe("5511999999999");
    expect(normalizarTelefone("1133334444")).toBe("551133334444");
  });

  it("preserva número que já vem com DDI", () => {
    expect(normalizarTelefone("+55 11 99999-9999")).toBe("5511999999999");
  });

  it("rejeita entrada sem dígito", () => {
    expect(() => normalizarTelefone("sem número")).toThrow();
  });
});
