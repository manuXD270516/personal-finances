-- COMMITMENTS: motor de recurrencia (openspec add-recurrence-engine, tarea 4.1; design.md § Modelo de datos y
-- decisiones 3, 5, 6, 10, 15 y 21; docs/08 §5.7; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * commitments.recurring_definition          WS: SELECT/INSERT/UPDATE para pf_app (sin DELETE: se termina, nunca se
--     borra). `managed_by` solo admite USER hoy (se relaja con un expand cuando Subscriptions/Debt administren
--     definiciones). `end_date` guarda la fecha de fin fijada por "terminar" (la serie se cierra ahí).
--   * commitments.recurring_definition_version  WS-RO: SELECT/INSERT; `platform.forbid_mutation()` (versiones inmutables,
--     PF003). Una fila por versión de la plantilla (cuentas, monto, categoría, regla, modo).
--   * commitments.recurring_occurrence          WS: SELECT/INSERT/UPDATE. UNIQUE (definition_id, occurrence_date) =
--     INV-013 (fecha NOMINAL, árbitro de `ON CONFLICT DO NOTHING`); UNIQUE parcial (workspace_id, transaction_id) para
--     las resueltas con transacción (una transacción resuelve a lo sumo una ocurrencia).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026).
--   * audit.lifecycle_state_divergences(): cubre también `RecurringDefinition` y `RecurringOccurrence`.
-- Sin backfill: las definiciones las crea el usuario y las ocurrencias las genera el motor.

-- migrate:up
CREATE SCHEMA commitments;
GRANT USAGE ON SCHEMA commitments TO pf_app;

CREATE TABLE commitments.recurring_definition (
  id                 uuid        PRIMARY KEY,
  workspace_id       uuid        NOT NULL REFERENCES iam.workspace (id),
  name               text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description        text        NULL CHECK (description IS NULL OR char_length(description) <= 1000),
  notes              text        NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  kind               text        NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE', 'TRANSFER')),
  managed_by         text        NOT NULL DEFAULT 'USER' CHECK (managed_by = 'USER'),
  managed_ref        uuid        NULL,
  status             text        NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED')),
  current_version_no integer     NOT NULL DEFAULT 1 CHECK (current_version_no >= 1),
  generated_through  date        NULL,
  end_date           date        NULL,
  ended_at           timestamptz NULL,
  version            integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        NULL,
  CONSTRAINT recurring_definition_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT recurring_definition_ended_ck CHECK ((status = 'ENDED') = (ended_at IS NOT NULL))
);
-- Índice del scheduler: definiciones activas por high-water mark de la generación.
CREATE INDEX recurring_definition_scheduler_ix
  ON commitments.recurring_definition (workspace_id, status, generated_through) WHERE status = 'ACTIVE';
CREATE INDEX recurring_definition_list_ix ON commitments.recurring_definition (workspace_id, status, name);
COMMENT ON TABLE commitments.recurring_definition IS
  'Definición recurrente (commitments/recurrence-engine): cabecera mutable; la plantilla vive en sus versiones inmutables.';

CREATE TABLE commitments.recurring_definition_version (
  workspace_id        uuid           NOT NULL REFERENCES iam.workspace (id),
  definition_id       uuid           NOT NULL,
  version_no          integer        NOT NULL CHECK (version_no >= 1),
  effective_from      date           NOT NULL,
  -- Referencias lógicas a accounts.* y classification.* (sin FK entre schemas, NFR-DATA-015).
  account_id          uuid           NOT NULL,
  to_account_id       uuid           NULL,
  currency            varchar(16)    NOT NULL REFERENCES fx.currency (code),
  amount_type         text           NOT NULL CHECK (amount_type IN ('FIXED', 'ESTIMATED', 'MIN_MAX', 'VARIABLE')),
  amount              numeric(38,18) NULL,
  amount_min          numeric(38,18) NULL,
  amount_max          numeric(38,18) NULL,
  category_id         uuid           NULL,
  counterparty_id     uuid           NULL,
  tag_ids             uuid[]         NOT NULL DEFAULT '{}',
  payment_method      text           NULL CHECK (payment_method IS NULL OR payment_method IN
                        ('CASH', 'QR', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'DIGITAL_WALLET', 'OTHER')),
  cadence             text           NOT NULL CHECK (cadence IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY',
                        'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM')),
  interval            smallint       NOT NULL CHECK (interval BETWEEN 1 AND 120),
  -- Días del mes de la cadencia como arreglo JSON de enteros (el export solo soporta arreglos de uuid/text/numeric).
  month_days          jsonb          NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(month_days) = 'array'),
  rrule               text           NULL CHECK (rrule IS NULL OR char_length(rrule) <= 500),
  dtstart             date           NOT NULL,
  until_date          date           NULL,
  max_count           integer        NULL CHECK (max_count IS NULL OR max_count BETWEEN 1 AND 1000),
  weekend_adjustment  text           NOT NULL DEFAULT 'NONE' CHECK (weekend_adjustment IN ('NONE', 'PREVIOUS', 'NEXT')),
  materialization_mode text          NOT NULL CHECK (materialization_mode IN ('AUTO_CREATE', 'PENDING_APPROVAL', 'NOTIFY_ONLY')),
  auto_create_status  text           NULL CHECK (auto_create_status IS NULL OR auto_create_status IN ('PENDING', 'POSTED')),
  lead_days           smallint       NOT NULL DEFAULT 3 CHECK (lead_days BETWEEN 0 AND 60),
  created_at          timestamptz    NOT NULL DEFAULT now(),
  created_by          uuid           NULL,
  PRIMARY KEY (definition_id, version_no),
  CONSTRAINT recurring_definition_version_def_fk FOREIGN KEY (workspace_id, definition_id)
    REFERENCES commitments.recurring_definition (workspace_id, id),
  CONSTRAINT recurring_definition_version_accounts_ck CHECK (to_account_id IS NULL OR to_account_id <> account_id),
  CONSTRAINT recurring_definition_version_amount_ck CHECK (
       (amount_type IN ('FIXED', 'ESTIMATED') AND amount > 0 AND amount_min IS NULL AND amount_max IS NULL)
    OR (amount_type = 'MIN_MAX' AND amount IS NULL AND amount_min > 0 AND amount_max >= amount_min)
    OR (amount_type = 'VARIABLE' AND amount IS NULL AND amount_min IS NULL AND amount_max IS NULL)
  ),
  CONSTRAINT recurring_definition_version_end_ck CHECK (until_date IS NULL OR max_count IS NULL),
  CONSTRAINT recurring_definition_version_custom_ck CHECK ((cadence = 'CUSTOM') = (rrule IS NOT NULL)),
  CONSTRAINT recurring_definition_version_mode_ck CHECK (
    (materialization_mode <> 'AUTO_CREATE' OR amount_type IN ('FIXED', 'ESTIMATED'))
    AND ((materialization_mode = 'AUTO_CREATE') = (auto_create_status IS NOT NULL))
  )
);
COMMENT ON TABLE commitments.recurring_definition_version IS
  'Versión inmutable de la plantilla de una definición ("esta y las siguientes"); WS-RO con forbid_mutation (PF003).';
CREATE TRIGGER recurring_definition_version_immutable_trg
  BEFORE UPDATE OR DELETE ON commitments.recurring_definition_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER recurring_definition_version_no_truncate_trg
  BEFORE TRUNCATE ON commitments.recurring_definition_version
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE commitments.recurring_occurrence (
  id                      uuid           PRIMARY KEY,
  workspace_id            uuid           NOT NULL REFERENCES iam.workspace (id),
  definition_id           uuid           NOT NULL,
  -- Fecha NOMINAL (antes del ajuste de fin de semana y de ediciones): clave de INV-013.
  occurrence_date         date           NOT NULL,
  due_date                date           NOT NULL,
  definition_version_no   integer        NOT NULL,
  expected_type           text           NOT NULL CHECK (expected_type IN ('FIXED', 'ESTIMATED', 'MIN_MAX', 'VARIABLE')),
  expected_amount         numeric(38,18) NULL,
  expected_min            numeric(38,18) NULL,
  expected_max            numeric(38,18) NULL,
  currency                varchar(16)    NOT NULL REFERENCES fx.currency (code),
  amount_overridden       boolean        NOT NULL DEFAULT false,
  date_overridden         boolean        NOT NULL DEFAULT false,
  status                  text           NOT NULL CHECK (status IN
                            ('SCHEDULED', 'DUE', 'OVERDUE', 'MATERIALIZED', 'MATCHED', 'SKIPPED', 'CANCELLED')),
  cancel_reason           text           NULL CHECK (cancel_reason IS NULL OR cancel_reason IN ('PAUSED', 'SUPERSEDED', 'ENDED')),
  -- Referencia lógica a txn.transaction (sin FK entre schemas): la integridad la dan el puerto y los índices únicos.
  transaction_id          uuid           NULL,
  resolution              text           NULL CHECK (resolution IS NULL OR resolution IN ('CREATED', 'MATCHED', 'SKIPPED')),
  matched_by              text           NULL CHECK (matched_by IS NULL OR matched_by IN ('USER_LINK', 'SUGGESTION')),
  skip_reason             text           NULL CHECK (skip_reason IS NULL OR char_length(skip_reason) <= 500),
  resolved_at             timestamptz    NULL,
  resolved_by             uuid           NULL,
  last_auto_create_error  text           NULL,
  last_auto_create_on     date           NULL,
  version                 integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT recurring_occurrence_ws_id_uk UNIQUE (workspace_id, id),
  -- INV-013: una sola ocurrencia por definición y fecha nominal.
  CONSTRAINT recurring_occurrence_nominal_uk UNIQUE (definition_id, occurrence_date),
  CONSTRAINT recurring_occurrence_def_fk FOREIGN KEY (workspace_id, definition_id)
    REFERENCES commitments.recurring_definition (workspace_id, id),
  CONSTRAINT recurring_occurrence_version_fk FOREIGN KEY (definition_id, definition_version_no)
    REFERENCES commitments.recurring_definition_version (definition_id, version_no),
  CONSTRAINT recurring_occurrence_txn_ck CHECK ((status IN ('MATERIALIZED', 'MATCHED')) = (transaction_id IS NOT NULL)),
  CONSTRAINT recurring_occurrence_cancel_ck CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL)),
  CONSTRAINT recurring_occurrence_amount_ck CHECK (
       (expected_type IN ('FIXED', 'ESTIMATED') AND expected_amount > 0 AND expected_min IS NULL AND expected_max IS NULL)
    OR (expected_type = 'MIN_MAX' AND expected_amount IS NULL AND expected_min > 0 AND expected_max >= expected_min)
    OR (expected_type = 'VARIABLE' AND expected_amount IS NULL AND expected_min IS NULL AND expected_max IS NULL)
  )
);
-- Una transacción resuelve a lo sumo una ocurrencia (defensa en profundidad de TRANSACTION_ALREADY_LINKED).
CREATE UNIQUE INDEX recurring_occurrence_txn_uq
  ON commitments.recurring_occurrence (workspace_id, transaction_id) WHERE status IN ('MATERIALIZED', 'MATCHED');
-- Comprometido y próximos pagos: no resueltas por vencimiento.
CREATE INDEX recurring_occurrence_open_ix
  ON commitments.recurring_occurrence (workspace_id, due_date) WHERE status IN ('SCHEDULED', 'DUE', 'OVERDUE');
CREATE INDEX recurring_occurrence_job_ix ON commitments.recurring_occurrence (workspace_id, status, due_date);
CREATE INDEX recurring_occurrence_def_ix ON commitments.recurring_occurrence (definition_id, occurrence_date);
COMMENT ON TABLE commitments.recurring_occurrence IS
  'Ocurrencia de una definición (agregado separado, alto volumen): fecha nominal única por definición (INV-013).';

-- RLS forzada por workspace (fail-closed con PF002) y grants.
ALTER TABLE commitments.recurring_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.recurring_definition FORCE ROW LEVEL SECURITY;
ALTER TABLE commitments.recurring_definition_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.recurring_definition_version FORCE ROW LEVEL SECURITY;
ALTER TABLE commitments.recurring_occurrence ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.recurring_occurrence FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON commitments.recurring_definition TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON commitments.recurring_definition_version TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON commitments.recurring_occurrence TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA commitments FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON commitments.recurring_definition TO pf_app;
GRANT SELECT, INSERT ON commitments.recurring_definition_version TO pf_app;
GRANT SELECT, INSERT, UPDATE ON commitments.recurring_occurrence TO pf_app;

-- Purga del workspace demo (ADR-0026): ocurrencias -> versiones -> definiciones (nadie más las referencia).
SELECT platform.register_workspace_scoped_table('commitments.recurring_occurrence'::regclass, 170, 'DELETE');
SELECT platform.register_workspace_scoped_table('commitments.recurring_definition_version'::regclass, 171, 'DELETE');
SELECT platform.register_workspace_scoped_table('commitments.recurring_definition'::regclass, 172, 'DELETE');

-- Consistencia del recorrido (add-lifecycle-timeline decisión 6): + RecurringDefinition y RecurringOccurrence.
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
    UNION ALL
    SELECT 'RecurringDefinition', rd.id, rd.status
      FROM commitments.recurring_definition rd WHERE rd.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringOccurrence', ro.id, ro.status
      FROM commitments.recurring_occurrence ro WHERE ro.workspace_id = platform.current_workspace_id()
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
    UNION ALL
    SELECT 'Reconciliation', rc.id, rc.status
      FROM txn.reconciliation rc WHERE rc.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'commitments'
   AND table_name IN ('recurring_occurrence', 'recurring_definition_version', 'recurring_definition');
DROP SCHEMA commitments CASCADE;
