import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.CREDENTIALS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.SESSION_SECRET ??= randomBytes(32).toString("base64");
});

describe("hash de senha", () => {
  it("verifica a senha correta e rejeita a errada", async () => {
    const { hashSenha, verificarSenha } = await import("@/lib/crypto");
    const hash = hashSenha("minha-senha-forte");
    expect(verificarSenha("minha-senha-forte", hash)).toBe(true);
    expect(verificarSenha("senha-errada", hash)).toBe(false);
  });

  it("gera hashes diferentes para a mesma senha (salt aleatório)", async () => {
    const { hashSenha } = await import("@/lib/crypto");
    expect(hashSenha("igual")).not.toBe(hashSenha("igual"));
  });
});

describe("sessão de login", () => {
  it("cria e verifica um token válido", async () => {
    const { criarTokenSessao, verificarTokenSessao } = await import("@/lib/session");
    const token = criarTokenSessao({ usuarioId: "u1", tenantId: "t1", papel: "admin" });
    const sessao = verificarTokenSessao(token);
    expect(sessao?.usuarioId).toBe("u1");
    expect(sessao?.tenantId).toBe("t1");
  });

  it("rejeita token adulterado", async () => {
    const { criarTokenSessao, verificarTokenSessao } = await import("@/lib/session");
    const token = criarTokenSessao({ usuarioId: "u1", tenantId: "t1", papel: "admin" });
    const [payload] = token.split(".");
    const adulterado = `${payload}.assinatura-forjada`;
    expect(verificarTokenSessao(adulterado)).toBeNull();
  });

  it("rejeita token de outra chave de sessão", async () => {
    const { criarTokenSessao } = await import("@/lib/session");
    const token = criarTokenSessao({ usuarioId: "u1", tenantId: "t1", papel: "admin" });

    process.env.SESSION_SECRET = randomBytes(32).toString("base64");
    const { resetEnvCache } = await import("@/lib/env");
    resetEnvCache();

    const { verificarTokenSessao } = await import("@/lib/session");
    expect(verificarTokenSessao(token)).toBeNull();
  });
});

describe("assinatura do webhook da Meta", () => {
  it("aceita assinatura correta e rejeita corpo adulterado", async () => {
    process.env.WHATSAPP_APP_SECRET = "segredo-do-app-meta";
    const { resetEnvCache } = await import("@/lib/env");
    resetEnvCache();

    const { verificarAssinaturaMeta } = await import("@/whatsapp/webhook");
    const { createHmac } = await import("node:crypto");

    const corpo = JSON.stringify({ entry: [] });
    const assinatura = `sha256=${createHmac("sha256", "segredo-do-app-meta").update(corpo).digest("hex")}`;

    expect(verificarAssinaturaMeta(corpo, assinatura)).toBe(true);
    expect(verificarAssinaturaMeta(`${corpo}adulterado`, assinatura)).toBe(false);
    expect(verificarAssinaturaMeta(corpo, null)).toBe(false);
  });
});

describe("link assinado do alerta", () => {
  it("aceita o token gerado para o próprio alerta", async () => {
    const { gerarTokenAlerta, verificarTokenAlerta } = await import("@/lib/link-alerta");
    const token = gerarTokenAlerta("alerta-123");
    expect(verificarTokenAlerta("alerta-123", token)).toBe(true);
  });

  it("rejeita o token de um alerta diferente", async () => {
    const { gerarTokenAlerta, verificarTokenAlerta } = await import("@/lib/link-alerta");
    const token = gerarTokenAlerta("alerta-123");
    expect(verificarTokenAlerta("alerta-999", token)).toBe(false);
  });

  it("rejeita ausência de token", async () => {
    const { verificarTokenAlerta } = await import("@/lib/link-alerta");
    expect(verificarTokenAlerta("alerta-123", null)).toBe(false);
  });
});
