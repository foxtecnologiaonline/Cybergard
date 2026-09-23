import { listarTenantsAtivos } from "@/repositories/tenants";
import { listarAlertas, resumoMensal } from "@/repositories/alertas";
import type { Alerta, Severidade } from "@/domain/types";

export const dynamic = "force-dynamic";

const ROTULO: Record<Severidade, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  informativo: "Informativo",
};

function formatar(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(data));
}

export default async function Painel() {
  const tenants = await listarTenantsAtivos();
  const tenant = tenants[0];

  if (!tenant) {
    return (
      <>
        <h1>Nenhuma empresa conectada</h1>
        <p className="vazio">
          Cadastre um tenant e conecte a primeira fonte de log em <code>POST /api/onboarding/fontes</code> para começar
          a receber alertas.
        </p>
      </>
    );
  }

  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);

  const [alertas, resumo] = await Promise.all([
    listarAlertas(tenant.id, 30),
    resumoMensal(tenant.id, inicioDoMes),
  ]);

  return (
    <>
      <h1>{tenant.nome}</h1>
      <p className="subtitulo">Alertas do mês e status de entrega</p>

      <section className="metricas">
        <div className="cartao">
          <div className="rotulo">Alertas no mês</div>
          <div className="valor">{resumo.total}</div>
        </div>
        <div className="cartao">
          <div className="rotulo">Taxa de falso positivo</div>
          <div className="valor">{(resumo.taxa * 100).toFixed(0)}%</div>
        </div>
        <div className="cartao">
          <div className="rotulo">Latência p95</div>
          <div className="valor">{resumo.latencia_p95_ms === null ? "—" : `${Math.round(resumo.latencia_p95_ms / 1000)}s`}</div>
        </div>
        <div className="cartao">
          <div className="rotulo">Críticos fora do SLA</div>
          <div className="valor">{resumo.criticos_fora_do_sla}</div>
        </div>
      </section>

      <section className="lista">
        {alertas.length === 0 ? (
          <p className="vazio">Nenhum alerta até agora. Silêncio aqui é boa notícia.</p>
        ) : (
          alertas.map((alerta: Alerta) => (
            <article key={alerta.id} className={`alerta ${alerta.severidade}`}>
              <div className="cabecalho">
                <span className={`etiqueta ${alerta.severidade}`}>{ROTULO[alerta.severidade]}</span>
                <span className="quando">{formatar(alerta.detectado_em)}</span>
              </div>
              <h2 style={{ fontSize: 16, margin: "8px 0 4px" }}>{alerta.titulo}</h2>
              <p style={{ margin: 0, color: "var(--texto-suave)", fontSize: 14 }}>{alerta.descricao}</p>
              <p className="acao">{alerta.acao_recomendada}</p>
            </article>
          ))
        )}
      </section>
    </>
  );
}
