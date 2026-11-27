-- COMMITMENTS: origen del monto esperado de una ocurrencia administrada (openspec fix-phase-4-debt-followups, tarea 4.1;
-- design.md decisión 2; docs/77 D481). Expand, no destructiva, sin backfill: las ocurrencias de tarjeta existentes
-- quedan con `NULL` y el primer paso diario de `debt.card-daily` las completa (la expectativa compara también el origen).
-- La tabla ya tiene RLS forzada y registro en `platform.workspace_scoped_table`. Se ejecuta con `pf_migrator`.

-- migrate:up
ALTER TABLE commitments.recurring_occurrence ADD COLUMN expected_basis text NULL;
ALTER TABLE commitments.recurring_occurrence ADD CONSTRAINT recurring_occurrence_expected_basis_check
  CHECK (expected_basis IS NULL OR expected_basis IN ('STATEMENT', 'OPEN_CYCLE', 'INSTALLMENTS')) NOT VALID;
ALTER TABLE commitments.recurring_occurrence VALIDATE CONSTRAINT recurring_occurrence_expected_basis_check;
COMMENT ON COLUMN commitments.recurring_occurrence.expected_basis IS
  'Origen del esperado fijado por el administrador (STATEMENT, OPEN_CYCLE, INSTALLMENTS); NULL si no lo informa o si el esperado dejó de ser el del administrador.';

-- migrate:down
ALTER TABLE commitments.recurring_occurrence DROP CONSTRAINT recurring_occurrence_expected_basis_check;
ALTER TABLE commitments.recurring_occurrence DROP COLUMN expected_basis;
