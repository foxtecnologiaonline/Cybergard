"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Fonte {
  id: string;
  tipo: string;
  nome: string;
  status: string;
  ultimo_evento_em: string | null;
}

const TIPOS = [
  { valor: "painel_admin", rotulo: "Painel administrativo" },
  { valor: "email_corporativo", rotulo: "E-mail corporativo" },
  { valor: "webhook_generico", rotulo: "Webhook genérico" },
] as const;

export default function Onboarding() {
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["valor"]>("painel_admin");
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novaConexao, setNovaConexao] = useState<{ token: string; urlIngestao: string } | null>(null);

  async function carregar(): Promise<void> {
    const response = await fetch("/api/onboarding/fontes");
    if (response.ok) {
      const corpo = (await response.json()) as { fontes: Fonte[] };
      setFontes(corpo.fontes);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  async function conectar(event: FormEvent): Promise<void> {
    event.preventDefault();
    setErro(null);
    setCriando(true);
    setNovaConexao(null);
    try {
      const response = await fetch("/api/onboarding/fontes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipo, nome }),
      });
      if (!response.ok) {
        const corpo = (await response.json().catch(() => null)) as { erro?: string } | null;
        setErro(corpo?.erro ?? "Não foi possível conectar a fonte.");
        return;
      }
      const corpo = (await response.json()) as { tokenIngest: string; urlIngestao: string };
      setNovaConexao({ token: corpo.tokenIngest, urlIngestao: corpo.urlIngestao });
      setNome("");
      await carregar();
    } finally {
      setCriando(false);
    }
  }

  return (
    <>
      <h1>Fontes de log</h1>
      <p className="subtitulo">Conecte o que sua empresa já usa para começar a receber alertas.</p>

      <form onSubmit={conectar} className="cartao" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20, maxWidth: 420 }}>
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Tipo de fonte</div>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as typeof tipo)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--borda)", background: "var(--fundo)", color: "var(--texto)" }}
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Nome (só pra você identificar)</div>
          <input
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Painel do sistema de vendas"
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--borda)", background: "var(--fundo)", color: "var(--texto)" }}
          />
        </label>

        {erro && <p style={{ color: "var(--critico)", fontSize: 14, margin: 0 }}>{erro}</p>}

        <button
          type="submit"
          disabled={criando}
          style={{ padding: 10, borderRadius: 8, border: "none", background: "var(--informativo)", color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          {criando ? "Conectando…" : "Conectar fonte"}
        </button>
      </form>

      {novaConexao && (
        <div className="cartao" style={{ marginTop: 16, borderColor: "var(--ok)" }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Fonte conectada. Guarde este token agora — ele não aparece de novo.</p>
          <p style={{ fontSize: 13, margin: "4px 0" }}>URL de envio: <code>{novaConexao.urlIngestao}</code></p>
          <p style={{ fontSize: 13, margin: "4px 0", wordBreak: "break-all" }}>Token: <code>{novaConexao.token}</code></p>
          <p style={{ fontSize: 13, marginTop: 8, color: "var(--texto-suave)" }}>
            Use o script <code>scripts/enviar-logs.ts</code> (documentado em <code>docs/integracao-fonte-log.md</code>) pra enviar log
            daqui em diante.
          </p>
        </div>
      )}

      <h2 style={{ marginTop: 32, fontSize: 16 }}>Fontes conectadas</h2>
      <div className="lista" style={{ marginTop: 12 }}>
        {fontes.length === 0 ? (
          <p className="vazio">Nenhuma fonte conectada ainda.</p>
        ) : (
          fontes.map((fonte) => (
            <div key={fonte.id} className="cartao" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{fonte.nome}</div>
                <div style={{ fontSize: 13, color: "var(--texto-suave)" }}>
                  {fonte.ultimo_evento_em ? `Último evento: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(fonte.ultimo_evento_em))}` : "Aguardando primeiro evento"}
                </div>
              </div>
              <span className={`etiqueta ${fonte.status === "conectada" ? "informativo" : fonte.status === "erro" ? "critico" : "atencao"}`}>
                {fonte.status}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
