-- migrate:up
-- Orden por agregado en el relay (openspec add-event-outbox, design punto 12; TC-PLATFORM-EVENTS-013).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
-- El relay solo publica la cabeza pendiente de cada agregado: un evento sale únicamente si no hay otro
-- anterior pendiente del mismo (workspace, agregado). Este índice sostiene esa consulta NOT EXISTS.
CREATE INDEX IF NOT EXISTS outbox_pending_aggregate_idx
  ON platform.outbox (workspace_id, aggregate_id, sequence)
  WHERE published_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS platform.outbox_pending_aggregate_idx;
