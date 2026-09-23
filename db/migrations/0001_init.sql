-- Cybergard v1 — schema multi-tenant.
-- Toda tabela de dado operacional carrega tenant_id e cascateia na exclusão do tenant (LGPD).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  cnpj            text,
  status          text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'em_exclusao')),
  fuso_horario    text NOT NULL DEFAULT 'America/Sao_Paulo',
  -- Janela comercial usada para classificar "login fora de horário".
  horario_inicio  smallint NOT NULL DEFAULT 8 CHECK (horario_inicio BETWEEN 0 AND 23),
  horario_fim     smallint NOT NULL DEFAULT 18 CHECK (horario_fim BETWEEN 1 AND 24),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  excluir_ate     timestamptz
);

-- Destinatários de alerta no WhatsApp.
CREATE TABLE destinatarios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome               text NOT NULL,
  telefone_e164      text NOT NULL,
  -- Severidade mínima que este destinatário recebe.
  severidade_minima  text NOT NULL DEFAULT 'atencao' CHECK (severidade_minima IN ('critico', 'atencao', 'informativo')),
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, telefone_e164)
);

CREATE INDEX destinatarios_tenant_ativo_idx ON destinatarios (tenant_id) WHERE ativo;

-- Fontes de log conectadas no onboarding (painel admin, e-mail corporativo, etc.).
CREATE TABLE fontes_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo                 text NOT NULL CHECK (tipo IN ('painel_admin', 'email_corporativo', 'webhook_generico')),
  nome                 text NOT NULL,
  -- Credencial da fonte cifrada em AES-256-GCM; nunca trafega nem aparece em log.
  credenciais_cifradas text,
  -- Hash SHA-256 do token que a fonte usa para postar em /api/ingest.
  token_ingest_hash    text NOT NULL,
  status               text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'conectada', 'erro')),
  ultimo_evento_em     timestamptz,
  ultimo_erro          text,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);

CREATE INDEX fontes_log_token_idx ON fontes_log (token_ingest_hash);
CREATE INDEX fontes_log_tenant_idx ON fontes_log (tenant_id);

-- Eventos brutos recebidos das fontes. Retenção curta (minimização LGPD).
CREATE TABLE eventos_log (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fonte_id       uuid NOT NULL REFERENCES fontes_log(id) ON DELETE CASCADE,
  ocorrido_em    timestamptz NOT NULL,
  recebido_em    timestamptz NOT NULL DEFAULT now(),
  tipo_evento    text NOT NULL,
  ator           text,
  ip_origem      inet,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enviado_sentinel boolean NOT NULL DEFAULT false
);

CREATE INDEX eventos_log_tenant_ocorrido_idx ON eventos_log (tenant_id, ocorrido_em DESC);
CREATE INDEX eventos_log_retencao_idx ON eventos_log (recebido_em);

-- Série temporal agregada por janela, consumida pelo Anomaly Detector.
CREATE TABLE metricas_acesso (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metrica     text NOT NULL CHECK (metrica IN ('logins', 'requisicoes', 'falhas_login')),
  janela      timestamptz NOT NULL,
  valor       double precision NOT NULL,
  PRIMARY KEY (tenant_id, metrica, janela)
);

CREATE INDEX metricas_acesso_janela_idx ON metricas_acesso (tenant_id, metrica, janela DESC);

-- Alertas consolidados (Sentinel + Anomaly Detector), já classificados.
CREATE TABLE alertas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  origem             text NOT NULL CHECK (origem IN ('sentinel', 'anomaly_detector')),
  -- Chave estável da origem; garante idempotência do poll e do scan.
  chave_externa      text NOT NULL,
  titulo             text NOT NULL,
  descricao          text NOT NULL,
  severidade         text NOT NULL CHECK (severidade IN ('critico', 'atencao', 'informativo')),
  severidade_origem  text,
  acao_recomendada   text NOT NULL,
  detectado_em       timestamptz NOT NULL,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  notificado_em      timestamptz,
  -- Latência detecção→notificação; base do critério de aceite de 5 min.
  latencia_ms        integer,
  falso_positivo     boolean,
  revisado_em        timestamptz,
  revisado_por       text,
  metadados          jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, origem, chave_externa)
);

CREATE INDEX alertas_tenant_detectado_idx ON alertas (tenant_id, detectado_em DESC);
CREATE INDEX alertas_pendentes_idx ON alertas (tenant_id, severidade) WHERE notificado_em IS NULL;

-- Envio de notificação por destinatário, com resultado da Meta Cloud API.
CREATE TABLE notificacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alerta_id        uuid NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
  destinatario_id  uuid NOT NULL REFERENCES destinatarios(id) ON DELETE CASCADE,
  canal            text NOT NULL DEFAULT 'whatsapp',
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviada', 'falha')),
  message_id       text,
  erro             text,
  tentativas       smallint NOT NULL DEFAULT 0,
  enviada_em       timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alerta_id, destinatario_id)
);

CREATE INDEX notificacoes_tenant_idx ON notificacoes (tenant_id, criado_em DESC);

-- Cursor de leitura do Sentinel por tenant, para não reprocessar incidente.
CREATE TABLE cursores_sentinel (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  ultimo_modificado_em timestamptz NOT NULL,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

-- Trilha de auditoria: quem acessou/alterou o quê (exigência LGPD de rastreabilidade).
CREATE TABLE auditoria (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  acao        text NOT NULL,
  ator        text NOT NULL,
  detalhes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auditoria_tenant_idx ON auditoria (tenant_id, criado_em DESC);
