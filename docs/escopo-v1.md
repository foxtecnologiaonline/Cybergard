# Cybergard — escopo v1

> Produto nascido do item 7 do roadmap FOX (SegurancaMPE), renomeado para **Cybergard**.
> Contexto padrão FOX TecnologIA: React Native/Expo, Next.js, PostgreSQL, BullMQ+Redis, S3/R2,
> Claude Sonnet como IA primária (Bedrock só como fallback), multi-tenant desde o MVP, LGPD desde o dia 1.

## Objetivo

Dar para a pequena empresa sem time de TI o mesmo tipo de monitoramento de segurança que só corporação grande tem hoje.

## Provedores

- **Microsoft Sentinel** — SIEM gerenciado, recebe os logs e gera incidentes.
- **Azure AI Anomaly Detector** — sinal de comportamento fora do padrão em métrica de uso/acesso.
- **Meta WhatsApp Cloud API** — canal de alerta (mesma infraestrutura ZapScript já usada na casa).

## Escopo funcional v1

- Onboarding conecta o que o tenant já usa (painel admin, e-mail corporativo, se aplicável) como fonte de log pro Sentinel.
- Anomaly Detector monitora padrão de acesso (login fora de horário, volume de requisição anormal).
- Alerta priorizado (crítico/atenção/informativo) enviado por WhatsApp, com ação recomendada em uma frase.
- Nenhuma ação de contenção automática no v1 — só alerta e recomendação, decisão de agir é sempre humana.

## Fora de escopo v1

Resposta automática a incidente (isolar conta, bloquear IP) — risco alto demais pra confiar sem supervisão no v1.

## Critérios de aceite

- Todo alerta crítico chega em menos de 5 minutos do evento detectado.
- Taxa de falso positivo monitorada e revisada mensalmente com o piloto.

## Como cada critério está implementado

**SLA de 5 minutos.** `alertas.detectado_em` marca a detecção (criação do incidente no Sentinel, ou o instante do scan de anomalia) e `notificado_em` marca a entrega. A diferença vira `latencia_ms` na mesma transação do envio. A fila usa prioridade por severidade (crítico = 1, atenção = 5, informativo = 10), então pico de informativo não empurra crítico para trás; a concorrência do worker de notificação é maior que a de detecção pelo mesmo motivo. Estouro de SLA é logado como `warn` e contado no painel.

**Falso positivo.** Cada alerta pode ser marcado como falso positivo (`POST /api/alertas/:id/revisao`), com autor e data em trilha de auditoria. O resumo mensal devolve total, revisados, taxa de falso positivo, latência p95 e quantos críticos estouraram o SLA — é a pauta da revisão mensal com o piloto.

## Regras de classificação

| Situação | Severidade |
| --- | --- |
| Incidente Sentinel `High` | crítico |
| Incidente Sentinel `Medium` com tática de alto impacto (CredentialAccess, PrivilegeEscalation, Exfiltration, Impact, Ransomware) | crítico |
| Incidente Sentinel `Medium` | atenção |
| Incidente Sentinel `Low` / `Informational` | informativo |
| Pico de falha de login, anomalia forte ou fora do horário | crítico |
| Pico de falha de login dentro do horário | atenção |
| Pico de login fora do horário comercial | crítico (forte) / atenção |
| Pico de requisição | atenção (forte) / informativo |
| Queda de volume | informativo — não é sinal de ataque |

Horário comercial é por tenant (fuso e janela configuráveis), avaliado no fuso do cliente e não no do servidor.

## LGPD

- Credencial de fonte de log cifrada em AES-256-GCM; nunca aparece em log (o logger redige campos sensíveis).
- Token de ingestão é guardado só como hash SHA-256 e exibido uma única vez, no onboarding.
- Retenção: log bruto 30 dias (minimização), alerta 365 dias (sustenta a revisão mensal). Configurável.
- Direito de esquecimento: `POST /api/tenants/:id/exclusao` marca o tenant e apaga tudo em até 24h, com a prova da exclusão preservada na auditoria.

## Provisionamento pendente (fora do código)

1. **Azure**: app registration (client credentials), Data Collection Endpoint + Data Collection Rule com o stream `Custom-CybergardLogs_CL`, workspace com Sentinel habilitado, recurso do Anomaly Detector.
2. **Meta**: número no WhatsApp Business e o template `cybergard_alerta` (pt_BR) aprovado, com 5 parâmetros no corpo — severidade, título, horário, ação recomendada e link.
3. **Piloto**: definir com o primeiro cliente quais fontes de log entram e qual a janela de horário comercial.

> Observação técnica: a Microsoft anunciou aposentadoria do Azure AI Anomaly Detector. A detecção está isolada em `src/azure/anomaly-detector.ts` atrás de uma interface própria, então trocar o motor (por outro serviço ou por detecção estatística local) não toca no resto do pipeline.
