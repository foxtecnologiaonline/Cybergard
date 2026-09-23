"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      if (!response.ok) {
        const corpo = (await response.json().catch(() => null)) as { erro?: string } | null;
        setErro(corpo?.erro ?? "Não foi possível entrar.");
        return;
      }
      router.push(params.get("proximo") ?? "/");
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "48px auto" }}>
      <h1>Entrar</h1>
      <p className="subtitulo">Acesse o painel de segurança da sua empresa.</p>

      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>E-mail</div>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--borda)", background: "var(--superficie)", color: "var(--texto)" }}
          />
        </label>
        <label>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Senha</div>
          <input
            type="password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--borda)", background: "var(--superficie)", color: "var(--texto)" }}
          />
        </label>

        {erro && <p style={{ color: "var(--critico)", fontSize: 14, margin: 0 }}>{erro}</p>}

        <button
          type="submit"
          disabled={enviando}
          style={{
            padding: 10,
            borderRadius: 8,
            border: "none",
            background: "var(--informativo)",
            color: "#fff",
            fontWeight: 600,
            cursor: enviando ? "default" : "pointer",
            opacity: enviando ? 0.7 : 1,
          }}
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
