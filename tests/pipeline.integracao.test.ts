import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prepararAmbiente } from "./setup-integracao";
import type { Stub } from "./stub-azure";

let stub: Stub;

// Módulos importados depois do env preparado — env() é resolvido no primeiro acesso.
let db: typeof import("@/lib/db");
let redisLib: typeof import("@/lib/redis");
let tenants: typeof import("@/repositories/tenants");
let fontes: typeof import("@/repositories/fontes-log");
let alertas: typeof import("@/repositories/alertas");
let ingestao: typeof import("@/services/ingestao");
let deteccao: typeof import("@/services/deteccao");
let notificacao: typeof import("@/services/notificacao");
let lgpd: typeof import("@/services/lgpd");
let filas: typeof import("@/queues");

beforeAll(async () => {
  stub = await prepararAmbiente();

  db = await import("@/lib/db");
  redisLib = await import("@/lib/redis");
  tenants = await import("@/repositories/tenants");
  fontes = await import("@/repositories/fontes-log");
  alertas = await import("@/repositories/alertas");
  ingestao = await import("@/services/ingestao");
  deteccao = await import("@/services/deteccao");
  notificacao = await import("@/services/notificacao");
  lgpd = await import("@/services/lgpd");
  filas = await import("@/queues");
});

afterAll(async () => {
  await filas.fecharFilas();
  await redisLib.closeRedis();
  await db.closeDb();
  await stub.fechar();
});

beforeEach(async () => {
  await db.query("TRUNCATE tenants, auditoria RESTART IDENTITY CASCADE");
  stub.state.incidentes = [];
  stub.state.mensagensWhatsapp = [];
  stub.state.lotesIngestao = [];
  stub.state.falharWhatsappVezes = 0;
});

async function criarTenantComDestinatario() {
  const tenant = await tenants.criarTenant({ nome: "Padaria do Zé" });
  await tenants.adicionarDestinatario({
    tenantId: tenant.id,
    nome: "Zé",
    telefoneE164: "5511999999999",
    severidadeMinima: "informativo",
  });
  return tenant;
}

describe("ingestão de log", () => {
  it("persiste eventos da fonte e encaminha o lote pro Sentinel", async () => {
    const tenant = await criarTenantComDestinatario();
    const { tokenIngest } = await fontes.criarFonteLog({
      tenantId: tenant.id,
      tipo: "painel_admin",
      nome: "Painel",
    });

    const resultado = await ingestao.ingerirLote({
      token: tokenIngest,
      eventos: [
        { ocorridoEm: new Date().toISOString(), tipoEvento: "login", ator: "ze@padaria.com", payload: {} },
        { ocorridoEm: new Date().toISOString(), tipoEvento: "login_falha", ator: "ze@padaria.com", payload: {} },
      ],
    });

    expect(resultado.persistidos).toBe(2);
    expect(resultado.encaminhados).toBe(true);
    expect(stub.state.lotesIngestao).toHaveLength(1);
    expect(stub.state.lotesIngestao[0]).toHaveLength(2);

    const listadas = await fontes.listarFontes(tenant.id);
    expect(listadas[0]?.status).toBe("conectada");
  });

  it("recusa token de ingestão inválido", async () => {
    await expect(
      ingestao.ingerirLote({
        token: "token-que-nao-existe",
        eventos: [{ ocorridoEm: new Date().toISOString(), tipoEvento: "login", payload: {} }],
      }),
    ).rejects.toThrow("Token de ingestão inválido");
  });
});

describe("pipeline Sentinel → WhatsApp", () => {
  it("entrega alerta crítico em menos de 5 minutos do evento detectado", async () => {
    const tenant = await criarTenantComDestinatario();
    const detectadoEm = new Date();

    stub.state.incidentes = [
      {
        id: "/subscriptions/x/incidents/1",
        name: "inc-001",
        properties: {
          incidentNumber: 1,
          title: "Acesso administrativo de IP desconhecido",
          description: "Login de administrador a partir de IP nunca visto.",
          severity: "High",
          status: "New",
          createdTimeUtc: detectadoEm.toISOString(),
          firstActivityTimeUtc: detectadoEm.toISOString(),
          lastModifiedTimeUtc: detectadoEm.toISOString(),
          additionalData: { tactics: ["InitialAccess"] },
        },
      },
    ];

    const poll = await deteccao.pollSentinel(tenant.id);
    expect(poll.novos).toBe(1);

    const [alerta] = await alertas.listarAlertas(tenant.id);
    expect(alerta?.severidade).toBe("critico");

    const resultado = await notificacao.notificarAlerta({ tenantId: tenant.id, alertaId: alerta!.id });

    expect(resultado.enviadas).toBe(1);
    expect(resultado.dentroDoSla).toBe(true);
    expect(resultado.latenciaMs).not.toBeNull();
    expect(resultado.latenciaMs!).toBeLessThan(5 * 60 * 1000);

    const enviada = stub.state.mensagensWhatsapp[0]?.body as Record<string, unknown>;
    expect(enviada.type).toBe("template");
    expect(enviada.to).toBe("5511999999999");
    const template = enviada.template as { components: { parameters: { text: string }[] }[] };
    expect(template.components[0]?.parameters[0]?.text).toBe("CRÍTICO");
  });

  it("não renotifica o mesmo incidente em um segundo poll", async () => {
    const tenant = await criarTenantComDestinatario();
    const agora = new Date();
    stub.state.incidentes = [
      {
        id: "/subscriptions/x/incidents/2",
        name: "inc-002",
        properties: {
          incidentNumber: 2,
          title: "Atividade incomum",
          severity: "Medium",
          status: "New",
          createdTimeUtc: agora.toISOString(),
          lastModifiedTimeUtc: agora.toISOString(),
        },
      },
    ];

    const primeiro = await deteccao.pollSentinel(tenant.id);
    const segundo = await deteccao.pollSentinel(tenant.id);

    expect(primeiro.novos).toBe(1);
    expect(segundo.novos).toBe(0);
    expect(await alertas.listarAlertas(tenant.id)).toHaveLength(1);
  });

  it("repete o envio quando a Meta responde indisponível e ainda entrega", async () => {
    const tenant = await criarTenantComDestinatario();
    stub.state.falharWhatsappVezes = 2;

    const { alerta } = await alertas.salvarAlerta({
      tenantId: tenant.id,
      origem: "sentinel",
      chaveExterna: "inc-retry",
      titulo: "Teste de retry",
      descricao: "",
      severidade: "critico",
      severidadeOrigem: "High",
      acaoRecomendada: "Verifique o acesso.",
      detectadoEm: new Date(),
      metadados: {},
    });

    const resultado = await notificacao.notificarAlerta({ tenantId: tenant.id, alertaId: alerta.id });
    expect(resultado.enviadas).toBe(1);
    expect(stub.state.mensagensWhatsapp).toHaveLength(1);
  });

  it("respeita a severidade mínima do destinatário", async () => {
    const tenant = await tenants.criarTenant({ nome: "Só críticos" });
    await tenants.adicionarDestinatario({
      tenantId: tenant.id,
      nome: "Dono",
      telefoneE164: "5511888888888",
      severidadeMinima: "critico",
    });

    const { alerta } = await alertas.salvarAlerta({
      tenantId: tenant.id,
      origem: "sentinel",
      chaveExterna: "inc-info",
      titulo: "Evento informativo",
      descricao: "",
      severidade: "informativo",
      severidadeOrigem: "Low",
      acaoRecomendada: "Nenhuma ação imediata.",
      detectadoEm: new Date(),
      metadados: {},
    });

    const resultado = await notificacao.notificarAlerta({ tenantId: tenant.id, alertaId: alerta.id });
    expect(resultado.enviadas).toBe(0);
    expect(stub.state.mensagensWhatsapp).toHaveLength(0);
  });
});

describe("detecção de anomalia de acesso", () => {
  it("gera alerta crítico para pico de falha de login", async () => {
    const tenant = await criarTenantComDestinatario();

    // 20 janelas de histórico calmo — o detector precisa de série para modelar.
    const base = new Date("2026-09-01T00:00:00Z");
    for (let i = 0; i < 20; i++) {
      await alertas.registrarMetrica({
        tenantId: tenant.id,
        metrica: "falhas_login",
        janela: new Date(base.getTime() + i * 3_600_000),
        valor: i === 19 ? 80 : 2,
      });
    }

    stub.state.anomalia = {
      isAnomaly: true,
      isPositiveAnomaly: true,
      isNegativeAnomaly: false,
      severity: 0.9,
      expectedValue: 2,
      upperMargin: 1,
      lowerMargin: 1,
    };

    const resultado = await deteccao.scanAnomalia({ tenantId: tenant.id, metrica: "falhas_login" });
    expect(resultado.analisado).toBe(true);
    expect(resultado.alertou).toBe(true);

    const [alerta] = await alertas.listarAlertas(tenant.id);
    expect(alerta?.severidade).toBe("critico");
    expect(alerta?.origem).toBe("anomaly_detector");
    expect(alerta?.acao_recomendada.length).toBeGreaterThan(20);
  });

  it("não analisa série curta demais", async () => {
    const tenant = await criarTenantComDestinatario();
    await alertas.registrarMetrica({
      tenantId: tenant.id,
      metrica: "logins",
      janela: new Date(),
      valor: 5,
    });

    const resultado = await deteccao.scanAnomalia({ tenantId: tenant.id, metrica: "logins" });
    expect(resultado.analisado).toBe(false);
    expect(await alertas.listarAlertas(tenant.id)).toHaveLength(0);
  });
});

describe("prioridade da fila em pico de volume", () => {
  it("puxa o alerta crítico antes dos informativos já enfileirados", async () => {
    const tenant = await criarTenantComDestinatario();
    const fila = filas.filaNotificacao();
    await fila.obliterate({ force: true });

    for (let i = 0; i < 20; i++) {
      await filas.enfileirarNotificacao({
        tenantId: tenant.id,
        alertaId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        severidade: "informativo",
        detectadoEmIso: new Date().toISOString(),
      });
    }

    await filas.enfileirarNotificacao({
      tenantId: tenant.id,
      alertaId: "11111111-1111-1111-1111-111111111111",
      severidade: "critico",
      detectadoEmIso: new Date().toISOString(),
    });

    // Só agora sobe o consumidor: com a fila já cheia, o primeiro puxado revela a prioridade real.
    const { Worker } = await import("bullmq");
    const processados: string[] = [];
    const worker = new Worker(
      filas.FILA_NOTIFICACAO,
      async (job) => {
        processados.push(job.data.severidade as string);
      },
      { connection: redisLib.redis(), concurrency: 1 },
    );

    await new Promise<void>((resolve) => {
      worker.on("completed", () => {
        if (processados.length >= 3) resolve();
      });
    });
    await worker.close();

    expect(processados[0]).toBe("critico");
    await fila.obliterate({ force: true });
  });
});

describe("LGPD", () => {
  it("apaga todos os dados do tenant depois do prazo de 24h", async () => {
    const tenant = await criarTenantComDestinatario();
    const { tokenIngest } = await fontes.criarFonteLog({
      tenantId: tenant.id,
      tipo: "painel_admin",
      nome: "Painel",
    });
    await ingestao.ingerirLote({
      token: tokenIngest,
      eventos: [{ ocorridoEm: new Date().toISOString(), tipoEvento: "login", payload: {} }],
    });

    await lgpd.solicitarExclusaoTenant({ tenantId: tenant.id, solicitadoPor: "titular" });

    // Antes do prazo nada é apagado.
    expect(await lgpd.executarExclusoesPendentes(new Date())).toBe(0);

    const depoisDoPrazo = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(await lgpd.executarExclusoesPendentes(depoisDoPrazo)).toBe(1);

    const restantes = await db.query("SELECT id FROM tenants WHERE id = $1", [tenant.id]);
    const eventos = await db.query("SELECT id FROM eventos_log WHERE tenant_id = $1", [tenant.id]);
    expect(restantes).toHaveLength(0);
    expect(eventos).toHaveLength(0);

    // A prova de que a exclusão ocorreu sobrevive ao titular.
    const auditoria = await db.query<{ acao: string }>(
      "SELECT acao FROM auditoria WHERE acao = 'lgpd.exclusao_executada'",
    );
    expect(auditoria).toHaveLength(1);
  });

  it("mantém credencial de fonte cifrada no banco", async () => {
    const tenant = await criarTenantComDestinatario();
    await fontes.criarFonteLog({
      tenantId: tenant.id,
      tipo: "email_corporativo",
      nome: "E-mail",
      credenciais: { senha: "segredo-do-cliente" },
    });

    const rows = await db.query<{ credenciais_cifradas: string }>(
      "SELECT credenciais_cifradas FROM fontes_log WHERE tenant_id = $1",
      [tenant.id],
    );
    expect(rows[0]?.credenciais_cifradas).not.toContain("segredo-do-cliente");
    expect(rows[0]?.credenciais_cifradas?.split(".")).toHaveLength(3);
  });
});
