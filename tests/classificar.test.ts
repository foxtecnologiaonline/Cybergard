import { describe, it, expect } from "vitest";
import {
  classificarIncidente,
  classificarAnomalia,
  acaoRecomendadaAnomalia,
  foraDoHorarioComercial,
  dentroDoSla,
  PRIORIDADE_FILA,
  SLA_CRITICO_MS,
} from "@/severity/classificar";
import type { IncidenteSentinel } from "@/azure/sentinel";
import type { ResultadoAnomalia } from "@/azure/anomaly-detector";

function incidente(over: Partial<IncidenteSentinel> = {}): IncidenteSentinel {
  return {
    id: "inc-1",
    numero: 1,
    titulo: "Atividade suspeita",
    descricao: "",
    severidade: "Medium",
    status: "New",
    criadoEm: new Date("2026-09-22T10:00:00Z"),
    modificadoEm: new Date("2026-09-22T10:01:00Z"),
    taticas: [],
    urlPortal: null,
    ...over,
  };
}

function anomalia(over: Partial<ResultadoAnomalia> = {}): ResultadoAnomalia {
  return {
    isAnomaly: true,
    isPositiveAnomaly: true,
    isNegativeAnomaly: false,
    severity: 0.8,
    expectedValue: 3,
    upperMargin: 1,
    lowerMargin: 1,
    ...over,
  };
}

describe("classificação de incidente do Sentinel", () => {
  it("mapeia High para crítico", () => {
    expect(classificarIncidente(incidente({ severidade: "High" }))).toBe("critico");
  });

  it("mapeia Low e Informational para informativo", () => {
    expect(classificarIncidente(incidente({ severidade: "Low" }))).toBe("informativo");
    expect(classificarIncidente(incidente({ severidade: "Informational" }))).toBe("informativo");
  });

  it("promove Medium a crítico quando a tática é de alto impacto", () => {
    expect(classificarIncidente(incidente({ severidade: "Medium", taticas: ["Exfiltration"] }))).toBe("critico");
  });

  it("mantém Medium como atenção quando a tática não é crítica", () => {
    expect(classificarIncidente(incidente({ severidade: "Medium", taticas: ["Discovery"] }))).toBe("atencao");
  });
});

describe("classificação de anomalia de acesso", () => {
  it("não alerta quando o detector não viu anomalia", () => {
    const resultado = classificarAnomalia({
      metrica: "logins",
      valor: 5,
      resultado: anomalia({ isAnomaly: false }),
      foraDoHorario: true,
    });
    expect(resultado).toBe("informativo");
  });

  it("trata pico de falha de login com severidade alta como crítico", () => {
    expect(
      classificarAnomalia({ metrica: "falhas_login", valor: 40, resultado: anomalia(), foraDoHorario: false }),
    ).toBe("critico");
  });

  it("trata pico fraco de falha de login dentro do horário como atenção", () => {
    expect(
      classificarAnomalia({
        metrica: "falhas_login",
        valor: 9,
        resultado: anomalia({ severity: 0.2 }),
        foraDoHorario: false,
      }),
    ).toBe("atencao");
  });

  it("eleva pico fraco de falha de login a crítico quando é fora do horário", () => {
    expect(
      classificarAnomalia({
        metrica: "falhas_login",
        valor: 9,
        resultado: anomalia({ severity: 0.2 }),
        foraDoHorario: true,
      }),
    ).toBe("critico");
  });

  it("só alerta login fora do padrão quando é fora do horário comercial", () => {
    expect(classificarAnomalia({ metrica: "logins", valor: 20, resultado: anomalia(), foraDoHorario: false })).toBe(
      "informativo",
    );
    expect(classificarAnomalia({ metrica: "logins", valor: 20, resultado: anomalia(), foraDoHorario: true })).toBe(
      "critico",
    );
  });

  it("queda de volume não vira alerta de segurança", () => {
    expect(
      classificarAnomalia({
        metrica: "requisicoes",
        valor: 0,
        resultado: anomalia({ isPositiveAnomaly: false, isNegativeAnomaly: true }),
        foraDoHorario: false,
      }),
    ).toBe("informativo");
  });

  it("dá ação recomendada em uma frase, sem jargão de TI", () => {
    const acao = acaoRecomendadaAnomalia({
      metrica: "falhas_login",
      valor: 30,
      resultado: anomalia(),
      foraDoHorario: true,
    });
    expect(acao).toContain("fora do horário comercial");
    expect(acao.split(". ").length).toBeLessThanOrEqual(2);
  });
});

describe("horário comercial do tenant", () => {
  it("usa o fuso do tenant, não o do servidor", () => {
    // 23:00 UTC = 20:00 em São Paulo — fora da janela 8h-18h.
    const instante = new Date("2026-09-22T23:00:00Z");
    expect(
      foraDoHorarioComercial({ instante, fusoHorario: "America/Sao_Paulo", inicio: 8, fim: 18 }),
    ).toBe(true);
  });

  it("reconhece horário comercial", () => {
    // 15:00 UTC = 12:00 em São Paulo.
    const instante = new Date("2026-09-22T15:00:00Z");
    expect(
      foraDoHorarioComercial({ instante, fusoHorario: "America/Sao_Paulo", inicio: 8, fim: 18 }),
    ).toBe(false);
  });
});

describe("prioridade de fila e SLA", () => {
  it("prioriza crítico acima de atenção e informativo", () => {
    expect(PRIORIDADE_FILA.critico).toBeLessThan(PRIORIDADE_FILA.atencao);
    expect(PRIORIDADE_FILA.atencao).toBeLessThan(PRIORIDADE_FILA.informativo);
  });

  it("cobra 5 minutos apenas do crítico", () => {
    expect(dentroDoSla("critico", SLA_CRITICO_MS - 1)).toBe(true);
    expect(dentroDoSla("critico", SLA_CRITICO_MS + 1)).toBe(false);
    expect(dentroDoSla("informativo", SLA_CRITICO_MS * 10)).toBe(true);
  });
});
