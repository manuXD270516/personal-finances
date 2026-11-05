-- PLANNING: base histórica de las líneas del plan (openspec add-historical-budgets, tarea 4.1; design.md § Modelo de datos).
-- Expand, no destructiva; se ejecuta con `pf_migrator`. Sin tablas nuevas ni defaults que reescriban datos.
--
--   * planning.budget_line.history_basis   Columna nullable (jsonb) con la base de la sugerencia aplicada desde el historial
--     (`schemaVersion` 1: método, N, ajuste, redondeo, periodos con su estado y real, monto sugerido y aplicado). Montos como
--     texto decimal. La valida el dominio (`HistoryBasis`); la BD solo exige que sea un objeto. Las políticas RLS, los grants
--     y el registro en `platform.workspace_scoped_table` de la tabla no cambian.
--   * Rollback: la versión anterior ignora la columna; nada que revertir.

-- migrate:up
ALTER TABLE planning.budget_line ADD COLUMN history_basis jsonb;

ALTER TABLE planning.budget_line
  ADD CONSTRAINT budget_line_history_basis_ck
  CHECK (history_basis IS NULL OR jsonb_typeof(history_basis) = 'object') NOT VALID;
ALTER TABLE planning.budget_line VALIDATE CONSTRAINT budget_line_history_basis_ck;

-- migrate:down
ALTER TABLE planning.budget_line DROP CONSTRAINT IF EXISTS budget_line_history_basis_ck;
ALTER TABLE planning.budget_line DROP COLUMN IF EXISTS history_basis;
