# Cybergard

Monitoramento de segurança cibernética para pequena empresa sem time de TI — o mesmo tipo de vigilância que hoje só corporação grande tem.

O Cybergard conecta as fontes de log que a empresa já usa, observa o padrão de acesso, e avisa no WhatsApp quando algo foge do normal — com a ação recomendada em uma frase, em português de quem não é de TI.

## O que a v1 faz

- **Onboarding** conecta as fontes de log do tenant (painel admin, e-mail corporativo, webhook genérico) e as encaminha para o Microsoft Sentinel.
- **Detecção** combina incidentes do Sentinel com anomalia de padrão de acesso (Azure AI Anomaly Detector): login fora de horário, pico de falha de login, volume de requisição anormal.
- **Classificação** em crítico / atenção / informativo, sempre com uma ação recomendada em uma frase.
- **Alerta por WhatsApp** com fila de prioridade — em pico de volume, o crítico passa na frente.
- **LGPD**: credencial cifrada em repouso, retenção curta de log bruto, trilha de auditoria e exclusão total em até 24h.

**O Cybergard não contém incidente sozinho.** Nada de isolar conta ou bloquear IP automaticamente na v1: só alerta e recomendação — a decisão de agir é sempre humana.

## Critérios de aceite

| Critério | Como é medido |
| --- | --- |
| Alerta crítico chega em menos de 5 min do evento detectado | `alertas.latencia_ms` (detecção → envio), p95 e contagem de estouros no painel |
| Taxa de falso positivo monitorada e revisada mensalmente | Marcação por alerta (`POST /api/alertas/:id/revisao`) e resumo mensal no painel |

## Stack

Next.js 15 (App Router) · PostgreSQL · BullMQ + Redis · TypeScript · Azure (Sentinel, Logs Ingestion API, AI Anomaly Detector) · Meta WhatsApp Cloud API. Multi-tenant desde o MVP.

## Rodando local

```bash
npm install
cp .env.example .env          # preencha as credenciais
npm run migrate               # cria o schema
npm run dev                   # app em http://localhost:3000
npm run worker                # em outro terminal: filas de detecção e notificação
```

Gerar a chave de cifragem de credenciais:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Testes

```bash
npm run typecheck
npm test        # unitários + integração (exige Postgres e Redis locais)
```

O teste de integração sobe um stub HTTP que responde como Azure AD, Sentinel, Anomaly Detector e Meta Cloud API — o pipeline roda inteiro sem tocar em serviço externo, inclusive a verificação do SLA de 5 minutos.

## Arquitetura

```
Fonte de log ──POST /api/ingest──► Postgres ──► Logs Ingestion API (DCR) ──► Sentinel
                                      │
                                      └──► métricas por janela ──► Anomaly Detector
                                                                        │
              Sentinel (poll de incidentes) ──────────────┬─────────────┘
                                                          ▼
                                          classificação de severidade
                                                          ▼
                                    fila BullMQ (prioridade por severidade)
                                                          ▼
                                            WhatsApp (Meta Cloud API)
```

| Caminho | Responsabilidade |
| --- | --- |
| `src/azure/` | Integração Azure: token AAD, ingestão via DCR, incidentes do Sentinel, Anomaly Detector |
| `src/severity/` | Classificação de severidade, ação recomendada, prioridade de fila e SLA |
| `src/services/` | Pipeline: ingestão, detecção, notificação, LGPD |
| `src/queues/` | Filas BullMQ e prioridade |
| `src/repositories/` | Acesso a dados, sempre com escopo de tenant |
| `src/worker.ts` | Processo de workers e agendamentos |
| `src/app/` | App Next.js: painel, detalhe de alerta e APIs |

## Configuração externa pendente

A aplicação está pronta; o que falta é provisionamento na Azure e na Meta (ver `docs/escopo-v1.md`): Data Collection Rule/Endpoint, workspace do Sentinel, recurso do Anomaly Detector, e o template `cybergard_alerta` aprovado na Meta.
