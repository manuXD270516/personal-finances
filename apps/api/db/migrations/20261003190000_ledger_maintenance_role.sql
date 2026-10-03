-- Mantenimiento del ledger (openspec add-ledger-core, tareas 4.5/5.5/5.6; design.md §Decisiones 9 y 10). Expand, no
-- destructiva. Se ejecuta con `pf_migrator`.
--
-- Crea el rol `pf_ledger_maintenance` (NOLOGIN, sin BYPASSRLS, NOINHERIT) que SOLO el worker puede asumir con
-- `SET LOCAL ROLE` dentro de la transacción del job (mismo patrón que `pf_maintenance`). Con él:
--   * `VerifyLedgerIntegrity` lee asientos, postings, reversas y snapshots de TODOS los workspaces (el verificador
--     diario recorre el ledger completo; NFR-DATA-008), sin conceder lectura entre workspaces a `pf_worker` en general.
--   * `RebuildBalanceSnapshots` borra y recalcula `ledger.balance_snapshot` (caché DRV, INV-022).
-- No puede escribir asientos ni postings (sin INSERT/UPDATE/DELETE en las tablas WS-RO).

-- migrate:up
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pf_ledger_maintenance') THEN
    CREATE ROLE pf_ledger_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA ledger TO pf_ledger_maintenance;
GRANT SELECT ON ledger.ledger_account, ledger.journal_entry, ledger.posting, ledger.entry_reversal
  TO pf_ledger_maintenance;
GRANT SELECT, INSERT, DELETE ON ledger.balance_snapshot TO pf_ledger_maintenance;
-- Catálogo global de monedas (escala canónica para reportar diferencias).
GRANT USAGE ON SCHEMA fx TO pf_ledger_maintenance;
GRANT SELECT ON fx.currency TO pf_ledger_maintenance;

CREATE POLICY ledger_maintenance_read ON ledger.ledger_account FOR SELECT TO pf_ledger_maintenance USING (true);
CREATE POLICY ledger_maintenance_read ON ledger.journal_entry FOR SELECT TO pf_ledger_maintenance USING (true);
CREATE POLICY ledger_maintenance_read ON ledger.posting FOR SELECT TO pf_ledger_maintenance USING (true);
CREATE POLICY ledger_maintenance_read ON ledger.entry_reversal FOR SELECT TO pf_ledger_maintenance USING (true);
CREATE POLICY ledger_maintenance_rw ON ledger.balance_snapshot TO pf_ledger_maintenance
  USING (true) WITH CHECK (true);

-- PG ≥ 16: pf_worker no hereda sus privilegios; solo puede asumirlo con SET LOCAL ROLE (pf_app no puede).
GRANT pf_ledger_maintenance TO pf_worker WITH INHERIT FALSE, SET TRUE;

-- migrate:down
REVOKE pf_ledger_maintenance FROM pf_worker;
DROP POLICY ledger_maintenance_rw ON ledger.balance_snapshot;
DROP POLICY ledger_maintenance_read ON ledger.entry_reversal;
DROP POLICY ledger_maintenance_read ON ledger.posting;
DROP POLICY ledger_maintenance_read ON ledger.journal_entry;
DROP POLICY ledger_maintenance_read ON ledger.ledger_account;
REVOKE ALL ON ledger.ledger_account, ledger.journal_entry, ledger.posting, ledger.entry_reversal,
  ledger.balance_snapshot FROM pf_ledger_maintenance;
REVOKE SELECT ON fx.currency FROM pf_ledger_maintenance;
REVOKE USAGE ON SCHEMA fx FROM pf_ledger_maintenance;
REVOKE USAGE ON SCHEMA ledger FROM pf_ledger_maintenance;
