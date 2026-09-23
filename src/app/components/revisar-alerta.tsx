"use client";

import { useState } from "react";

export function RevisarAlerta({ alertaId, revisado }: { alertaId: string; revisado: boolean | null }) {
  const [estado, setEstado] = useState<boolean | null>(revisado);
  const [enviando, setEnviando] = useState(false);

  async function marcar(falsoPositivo: boolean): Promise<void> {
    setEnviando(true);
    try {
      const response = await fetch(`/api/alertas/${alertaId}/revisao`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ falsoPositivo }),
      });
      if (response.ok) setEstado(falsoPositivo);
    } finally {
      setEnviando(false);
    }
  }

  if (estado !== null) {
    return (
      <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 6 }}>
        {estado ? "Marcado como falso positivo." : "Confirmado como alerta real."}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button
        onClick={() => void marcar(true)}
        disabled={enviando}
        style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--borda)", background: "transparent", color: "var(--texto)", cursor: "pointer" }}
      >
        Foi falso positivo
      </button>
      <button
        onClick={() => void marcar(false)}
        disabled={enviando}
        style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--borda)", background: "transparent", color: "var(--texto)", cursor: "pointer" }}
      >
        Era real
      </button>
    </div>
  );
}
