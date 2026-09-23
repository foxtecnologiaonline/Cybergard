-- Autenticação: um usuário pertence a exatamente um tenant (sem multi-tenant por usuário na v1).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE usuarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  senha_hash  text NOT NULL,
  papel       text NOT NULL DEFAULT 'admin' CHECK (papel IN ('admin', 'membro')),
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  ultimo_login_em timestamptz
);

CREATE UNIQUE INDEX usuarios_email_idx ON usuarios (email);
CREATE INDEX usuarios_tenant_idx ON usuarios (tenant_id);
