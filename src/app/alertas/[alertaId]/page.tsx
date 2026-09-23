import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { verificarTokenAlerta } from "@/lib/link-alerta";
import { obterSessao } from "@/lib/session";
import type { Alerta, Severidade } from "@/domain/types";

export const dynamic = "force-dynamic";

const ROTULO: Record<Severidade, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  informativo: "Informativo",
};

export default async function DetalheAlerta({
  params,
  searchParams,
}: {
  params: Promise<{ alertaId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { alertaId } = await params;
  const { t } = await searchParams;

  const alerta = await queryOne<Alerta>(`SELECT * FROM alertas WHERE id = $1`, [alertaId]);
  if (!alerta) notFound();

  // Duas portas de entrada: o link assinado do WhatsApp, ou uma sessão logada do mesmo tenant.
  const tokenValido = verificarTokenAlerta(alertaId, t ?? null);
  if (!tokenValido) {
    const sessao = await obterSessao();
    if (!sessao || sessao.tenantId !== alerta.tenant_id) notFound();
  }

  const quando = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeStyle: "short" }).format(
    new Date(alerta.detectado_em),
  );

  return (
    <article className={`alerta ${alerta.severidade}`}>
      <div className="cabecalho">
        <span className={`etiqueta ${alerta.severidade}`}>{ROTULO[alerta.severidade]}</span>
        <span className="quando">{quando}</span>
      </div>

      <h1 style={{ marginTop: 12 }}>{alerta.titulo}</h1>
      <p>{alerta.descricao}</p>

      <h2 style={{ fontSize: 15 }}>O que fazer</h2>
      <p className="acao">{alerta.acao_recomendada}</p>

      <p className="quando">
        Origem: {alerta.origem === "sentinel" ? "Microsoft Sentinel" : "Detecção de anomalia"}
        {alerta.latencia_ms !== null && ` · entregue em ${Math.round(alerta.latencia_ms / 1000)}s`}
      </p>

      <p className="quando">
        O Cybergard não bloqueia nem isola nada sozinho: a decisão de agir é sempre sua.
      </p>
    </article>
  );
}
