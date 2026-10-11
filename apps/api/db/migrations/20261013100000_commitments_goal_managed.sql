-- COMMITMENTS: aporte recurrente de una meta como compromiso administrado (openspec add-savings-goals, decisión 18, N5).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * recurring_definition.managed_by: el CHECK admite también `GOAL` (la meta administra una definición `TRANSFER`
--     mensual de monto fijo). Se amplía con NOT VALID + VALIDATE. Sin columnas nuevas ni backfill.
--   * recurring_definition_goal_kind_ck: una definición administrada por `GOAL` es siempre de tipo `TRANSFER`
--     (defensa en profundidad de la guarda de dominio).

-- migrate:up
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_managed_by_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_managed_by_check
    CHECK (managed_by IN ('USER', 'SUBSCRIPTION', 'DEBT', 'GOAL')) NOT VALID,
  ADD CONSTRAINT recurring_definition_goal_kind_ck
    CHECK (managed_by <> 'GOAL' OR kind = 'TRANSFER') NOT VALID;
ALTER TABLE commitments.recurring_definition VALIDATE CONSTRAINT recurring_definition_managed_by_check;
ALTER TABLE commitments.recurring_definition VALIDATE CONSTRAINT recurring_definition_goal_kind_ck;

-- migrate:down
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_goal_kind_ck,
  DROP CONSTRAINT recurring_definition_managed_by_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_managed_by_check CHECK (managed_by IN ('USER', 'SUBSCRIPTION', 'DEBT'));
