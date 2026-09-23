-- Status de entrega real, vindo do webhook da Meta (sent/delivered/read/failed).

ALTER TABLE notificacoes DROP CONSTRAINT notificacoes_status_check;
ALTER TABLE notificacoes ADD CONSTRAINT notificacoes_status_check
  CHECK (status IN ('pendente', 'enviada', 'entregue', 'lida', 'falha'));

ALTER TABLE notificacoes ADD COLUMN entregue_em timestamptz;
ALTER TABLE notificacoes ADD COLUMN lida_em timestamptz;
