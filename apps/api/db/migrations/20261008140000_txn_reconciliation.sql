-- TRANSACTIONS: sesiones de reconciliación (openspec add-reconciliation, tarea 4.1; design.md § Modelo de datos y plan de
-- migración; docs/08 §5.4; docs/33 D74, D77, D111). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * txn.reconciliation       WS: SELECT/INSERT/UPDATE para pf_app (sin DELETE). Una sesión IN_PROGRESS por cuenta
--                              (índice único parcial); CHECKs de estado ↔ fechas ↔ saldo confirmado y diferencia 0.
--   * txn.reconciliation_item  WS: SELECT/INSERT para pf_app y UPDATE solo de las columnas `unreconciled_*` (la
--                              des-reconciliación posterior no altera el resultado de la sesión, decisión 8).
--   * txn.transaction          + reconciliation_id (solo el ajuste que crea una sesión) y reconciliation_mode
--                              (STATEMENT | WITHOUT_STATEMENT; no nulo si y solo si el estado es RECONCILED, D74).
--                              Las RECONCILED de Phase 1 se rellenan con WITHOUT_STATEMENT (D77): sin sesión retroactiva
--                              ni transiciones nuevas; quedan con la marca de seguimiento. El relleno suspende FORCE RLS
--                              solo dentro de esta migración (el dueño corre sin workspace; la transacción de dbmate
--                              mantiene ACCESS EXCLUSIVE hasta confirmar) y es idempotente.
--   * audit.lifecycle_state_divergences(): cubre también `Reconciliation` (estado persistido ↔ última transición).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026).

-- migrate:up
CREATE TABLE txn.reconciliation (
  id                        uuid           PRIMARY KEY,
  workspace_id              uuid           NOT NULL REFERENCES iam.workspace (id),
  account_id                uuid           NOT NULL,
  currency                  varchar(16)    NOT NULL REFERENCES fx.currency (code),
  statement_date            date           NOT NULL,
  statement_balance         numeric(38,18) NOT NULL,
  cleared_balance           numeric(38,18) NULL,
  difference                numeric(38,18) NULL,
  status                    text           NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  adjustment_transaction_id uuid           NULL,
  -- Reservado para Phase 6 (documents/attachments: PDF del extracto); sin FK.
  statement_document_id     uuid           NULL,
  started_by                uuid           NOT NULL,
  started_at                timestamptz    NOT NULL DEFAULT now(),
  completed_by              uuid           NULL,
  completed_at              timestamptz    NULL,
  cancelled_by              uuid           NULL,
  cancelled_at              timestamptz    NULL,
  version                   integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT reconciliation_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT reconciliation_adjustment_fk FOREIGN KEY (workspace_id, adjustment_transaction_id)
    REFERENCES txn.transaction (workspace_id, id),
  -- COMPLETED ⇔ completed_at y saldo confirmado congelados con diferencia 0.
  CONSTRAINT reconciliation_completed_ck CHECK (
    (status = 'COMPLETED') = (completed_at IS NOT NULL AND completed_by IS NOT NULL
                              AND cleared_balance IS NOT NULL AND difference IS NOT NULL)
    AND (status <> 'COMPLETED' OR difference = 0)),
  CONSTRAINT reconciliation_cancelled_ck CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  CONSTRAINT reconciliation_adjustment_ck CHECK (adjustment_transaction_id IS NULL OR status = 'COMPLETED')
);
-- Una sola sesión en curso por cuenta (RECONCILIATION_IN_PROGRESS).
CREATE UNIQUE INDEX reconciliation_in_progress_uk ON txn.reconciliation (workspace_id, account_id)
  WHERE status = 'IN_PROGRESS';
CREATE INDEX reconciliation_account_date_ix ON txn.reconciliation (workspace_id, account_id, statement_date DESC);
COMMENT ON TABLE txn.reconciliation IS
  'Sesiones de reconciliación por cuenta contra el saldo de un extracto (transactions/reconciliation).';

CREATE TABLE txn.reconciliation_item (
  workspace_id               uuid        NOT NULL,
  reconciliation_id          uuid        NOT NULL,
  transaction_id             uuid        NOT NULL,
  reconciled_at              timestamptz NOT NULL DEFAULT now(),
  -- true ⇒ ya estaba conciliada sin extracto y la sesión la coteja (decisión 14).
  verified_without_statement boolean     NOT NULL DEFAULT false,
  unreconciled_at            timestamptz NULL,
  unreconciled_by            uuid        NULL,
  unreconcile_reason         text        NULL CHECK (unreconcile_reason IS NULL OR length(unreconcile_reason) BETWEEN 1 AND 500),
  PRIMARY KEY (workspace_id, reconciliation_id, transaction_id),
  CONSTRAINT reconciliation_item_reconciliation_fk FOREIGN KEY (workspace_id, reconciliation_id)
    REFERENCES txn.reconciliation (workspace_id, id),
  CONSTRAINT reconciliation_item_transaction_fk FOREIGN KEY (workspace_id, transaction_id)
    REFERENCES txn.transaction (workspace_id, id),
  CONSTRAINT reconciliation_item_unreconciled_ck CHECK (
    (unreconciled_at IS NULL) = (unreconciled_by IS NULL) AND (unreconciled_at IS NULL) = (unreconcile_reason IS NULL))
);
CREATE INDEX reconciliation_item_tx_ix ON txn.reconciliation_item (workspace_id, transaction_id);
COMMENT ON TABLE txn.reconciliation_item IS
  'Transacciones reconciliadas (o cotejadas) por una sesión; la des-reconciliación posterior se anota sin alterar la sesión.';

-- ---------------------------------------------------------------- txn.transaction (columnas aditivas, D74/D77/D111)
ALTER TABLE txn.transaction ADD COLUMN reconciliation_id uuid NULL;
ALTER TABLE txn.transaction ADD COLUMN reconciliation_mode text NULL
  CHECK (reconciliation_mode IS NULL OR reconciliation_mode IN ('STATEMENT', 'WITHOUT_STATEMENT'));
COMMENT ON COLUMN txn.transaction.reconciliation_id IS
  'Sesión que creó la transacción (solo el ajuste de una sesión de reconciliación); sin FK para no cerrar un ciclo.';
COMMENT ON COLUMN txn.transaction.reconciliation_mode IS
  'STATEMENT = cotejada contra un extracto; WITHOUT_STATEMENT = marcado directo explícito (D74). No nulo si y solo si RECONCILED.';

-- D77: las RECONCILED de Phase 1 se conservan y quedan como conciliadas sin extracto (idempotente).
ALTER TABLE txn.transaction NO FORCE ROW LEVEL SECURITY;
UPDATE txn.transaction SET reconciliation_mode = 'WITHOUT_STATEMENT'
 WHERE status = 'RECONCILED' AND reconciliation_mode IS NULL;
ALTER TABLE txn.transaction FORCE ROW LEVEL SECURITY;

ALTER TABLE txn.transaction ADD CONSTRAINT transaction_reconciliation_mode_ck
  CHECK ((status = 'RECONCILED') = (reconciliation_mode IS NOT NULL)) NOT VALID;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_reconciliation_mode_ck;

-- Filtro `systemFlag=RECONCILED_WITHOUT_STATEMENT` e indicador por cuenta (D111).
CREATE INDEX transaction_without_statement_ix ON txn.transaction (workspace_id, account_id, transaction_date)
  WHERE reconciliation_mode = 'WITHOUT_STATEMENT';

-- ---------------------------------------------------------------- RLS y grants
ALTER TABLE txn.reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.reconciliation FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.reconciliation_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.reconciliation_item FORCE ROW LEVEL SECURITY;
-- Fail-closed (PF002): `platform.current_workspace_id()` falla si la transacción no fijó el workspace.
CREATE POLICY ws_isolation ON txn.reconciliation TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON txn.reconciliation_item TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON txn.reconciliation, txn.reconciliation_item FROM PUBLIC;
REVOKE ALL ON txn.reconciliation, txn.reconciliation_item FROM pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON txn.reconciliation TO pf_app;
GRANT SELECT, INSERT ON txn.reconciliation_item TO pf_app;
GRANT UPDATE (unreconciled_at, unreconciled_by, unreconcile_reason) ON txn.reconciliation_item TO pf_app;

-- Purga del workspace demo (ADR-0026): los ítems primero, luego las sesiones; ambas antes que txn.transaction (orden
-- 40) porque la referencian (el ajuste y los ítems).
SELECT platform.register_workspace_scoped_table('txn.reconciliation_item'::regclass, 10, 'DELETE');
SELECT platform.register_workspace_scoped_table('txn.reconciliation'::regclass, 25, 'DELETE');

-- Consistencia del recorrido (add-lifecycle-timeline decisión 6): + Reconciliation (estado persistido).
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'FinancialPeriod', fp.id, fp.status
      FROM planning.financial_period fp WHERE fp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Reconciliation', rc.id, rc.status
      FROM txn.reconciliation rc WHERE rc.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'FinancialPeriod', fp.id, fp.status
      FROM planning.financial_period fp WHERE fp.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'txn' AND table_name IN ('reconciliation', 'reconciliation_item');
DROP INDEX txn.transaction_without_statement_ix;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_reconciliation_mode_ck;
ALTER TABLE txn.transaction DROP COLUMN reconciliation_mode;
ALTER TABLE txn.transaction DROP COLUMN reconciliation_id;
DROP TABLE txn.reconciliation_item;
DROP TABLE txn.reconciliation;
