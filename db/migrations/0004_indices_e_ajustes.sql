-- O webhook da Meta faz UPDATE ... WHERE message_id = $1 a cada evento de status;
-- sem índice isso é full table scan assim que notificacoes crescer.
CREATE INDEX notificacoes_message_id_idx ON notificacoes (message_id) WHERE message_id IS NOT NULL;

-- Suporta o retry idempotente de notificarAlerta: buscar quem já foi notificado com
-- sucesso pra um alerta (índice parcial, só nas linhas que a consulta filtra).
CREATE INDEX notificacoes_alerta_sucesso_idx ON notificacoes (alerta_id)
  WHERE status IN ('enviada', 'entregue', 'lida');
