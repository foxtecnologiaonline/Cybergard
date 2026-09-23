# Cybergard

Monitoramento de segurança cibernética para pequena empresa sem time de TI — o mesmo tipo de vigilância que hoje só corporação grande tem.

O Cybergard conecta as fontes de log que a empresa já usa, observa o padrão de acesso, e avisa no WhatsApp quando algo foge do normal — com a ação recomendada em uma frase, em português de quem não é de TI.

## O que a v1 faz

- **Login por tenant**: cada empresa tem seus próprios usuários; ninguém vê alerta de outra empresa.
- **Onboarding** (autenticado) conecta as fontes de log do tenant (painel admin, e-mail corporativo, webhook genérico) e as encaminha para o Microsoft Sentinel.
- **Detecção** combina incidentes do Sentinel com anomalia de padrão de acesso (Azure AI Anomaly Detector): login fora de horário, pico de falha de login, volume de requisição anormal.
- **Classificação** em crítico / atenção / informativo, sempre com uma ação recomendada em uma frase.
- **Alerta por WhatsApp** com fila de prioridade — em pico de volume, o crítico passa na frente — via link assinado que abre sem exigir login no celular.
- **Confirmação de entrega**: webhook da Meta atualiza o status (enviada/entregue/lida/falha) de cada notificação.
- **LGPD**: credencial cifrada em repouso, retenção curta de log bruto, trilha de auditoria e exclusão total em até 24h.
- **Observabilidade mínima**: `/api/health` reporta Postgres, Redis e se o worker está vivo (heartbeat).

**O Cybergard não contém incidente sozinho.** Nada de isolar conta ou bloquear IP automaticamente na v1: só alerta e recomendação — a decisão de agir é sempre humana.

## Critérios de aceite

| Critério | Como é medido |
| --- | --- |
| Alerta crítico chega em menos de 5 min do evento detectado | `alertas.latencia_ms` (detecção → envio), p95 e contagem de estouros no painel |
| Taxa de falso positivo monitorada e revisada mensalmente | Marcação por alerta (botão no painel / `POST /api/alertas/:id/revisao`) e resumo mensal no painel |

## Stack

Next.js 15 (App Router) · PostgreSQL · BullMQ + Redis · TypeScript · Azure (Sentinel, Logs Ingestion API, AI Anomaly Detector) · Meta WhatsApp Cloud API. Multi-tenant desde o MVP, autenticação por sessão própria (sem dependência externa).

## Rodando com Docker (recomendado)

```bash
cp .env.example .env          # preencha as credenciais
docker compose run --rm migrate     # cria o schema
docker compose up -d app worker
```

App em `http://localhost:3000`. `docker compose logs -f worker` acompanha o processamento de filas.

## Rodando local sem Docker

```bash
npm install
cp .env.example .env          # preencha as credenciais
npm run migrate               # cria o schema
npm run dev                   # app em http://localhost:3000
npm run worker                # em outro terminal: filas de detecção e notificação
```

Gerar as chaves obrigatórias (cifragem de credencial e assinatura de sessão):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Criar o primeiro usuário de um tenant (não há cadastro público — é provisionado pela FOX):

```bash
npm run criar-usuario -- --tenant <uuid-do-tenant> --email dono@empresa.com --senha "senha-forte"
```

## Testes

```bash
npm run typecheck
npm test        # unitários + integração (exige Postgres e Redis locais)
```

O teste de integração sobe um stub HTTP que responde como Azure AD, Sentinel, Anomaly Detector e Meta Cloud API — o pipeline roda inteiro sem tocar em serviço externo, inclusive a verificação do SLA de 5 minutos.

## CI

`.github/workflows/ci.yml` roda typecheck, migrations, testes (com Postgres e Redis de serviço) e build em todo push/PR.

## Arquitetura

```
Fonte de log ──POST /api/ingest──► Postgres ──► Logs Ingestion API (DCR) ──► Sentinel
   (autenticado por token de fonte,     │
    rate limit por minuto)              └──► métricas por janela ──► Anomaly Detector
                                                                          │
              Sentinel (poll de incidentes) ──────────────┬───────────────┘
                                                          ▼
                                          classificação de severidade
                                                          ▼
                                    fila BullMQ (prioridade por severidade,
                                    conexão dedicada por worker — ver src/lib/redis.ts)
                                                          ▼
                                     WhatsApp (Meta Cloud API, link assinado)
                                                          ▼
                                webhook de status ──► notificacoes.status
```

| Caminho | Responsabilidade |
| --- | --- |
| `src/azure/` | Integração Azure: token AAD, ingestão via DCR, incidentes do Sentinel, Anomaly Detector |
| `src/severity/` | Classificação de severidade, ação recomendada, prioridade de fila e SLA |
| `src/services/` | Pipeline: ingestão, detecção, notificação, LGPD |
| `src/queues/` | Filas BullMQ e prioridade |
| `src/repositories/` | Acesso a dados, sempre com escopo de tenant |
| `src/lib/session.ts`, `src/middleware.ts` | Autenticação por cookie assinado (HMAC), protege toda rota exceto as listadas no middleware |
| `src/lib/link-alerta.ts` | Token assinado do link de alerta enviado por WhatsApp |
| `src/whatsapp/webhook.ts` | Verificação de assinatura e status de entrega da Meta |
| `src/worker.ts` | Processo de workers, agendamentos e heartbeat |
| `src/app/` | App Next.js: login, painel, onboarding, detalhe de alerta e APIs |
| `scripts/enviar-logs.ts` | CLI pra enviar log de uma fonte que não tem integração automática (ver `docs/integracao-fonte-log.md`) |
| `Dockerfile`, `docker-compose.yml` | Build multi-stage (app / worker / migrate) |

## Configuração externa pendente

A aplicação está pronta; o que falta é provisionamento na Azure e na Meta (ver `docs/escopo-v1.md`): Data Collection Rule/Endpoint, workspace do Sentinel, recurso do Anomaly Detector, template `cybergard_alerta` aprovado na Meta, e a URL do webhook (`/api/webhooks/whatsapp`) cadastrada no app da Meta com `WHATSAPP_WEBHOOK_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`.
