-- COMMITMENTS: suscripciones (openspec add-subscriptions, tareas 4.1 y 4.2; design.md § Modelo de datos y decisiones 1,
-- 2, 6, 8 y 12; docs/08 §5.7; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * recurring_definition.managed_by: el CHECK admite ahora `SUBSCRIPTION` además de `USER` (`DEBT` sigue reservado).
--     Una definición administrada exige `managed_ref` (la suscripción) y una de usuario no lo lleva.
--   * recurring_definition_version.indexed_amount / indexed_currency: precio indexado (N3). La plantilla queda `VARIABLE`
--     y cada ocurrencia estima `precio × tasa de valoración vigente al generarla`. El CHECK de modo admite `AUTO_CREATE`
--     con un monto indexado (si no hay tasa el intento queda con error y se reintenta al día siguiente).
--   * commitments.subscription                  WS: cabecera mutable. UNIQUE (definition_id): una definición por suscripción.
--   * commitments.subscription_price            WS-RO: historial de precios append-only (`platform.forbid_mutation()`).
--     UNIQUE (supersedes_id): un solo reemplazo por entrada.
--   * commitments.subscription_price_proposal   WS: propuestas de la detección. UNIQUE (subscription_id, effective_from) y
--     UNIQUE parcial (subscription_id) WHERE status = 'PENDING' (a lo sumo una pendiente).
--   * commitments.subscription_charge           WS: cargo vinculado a una transacción. UNIQUE parcial
--     (subscription_id, occurrence_id) WHERE outcome <> 'VOIDED' (un cargo vigente por ocurrencia: idempotencia de negocio).
--   * commitments.subscription_reminder         WS-RO: recordatorios emitidos; PK (workspace, suscripción, tipo, fecha) =
--     exactamente una vez por fecha.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026): antes que las definiciones (172).
--   * audit.lifecycle_state_divergences(): cubre también `Subscription`.
-- `pf_worker` es miembro de `pf_app` y hereda sus grants y políticas. Sin backfill: las crea el usuario.

-- migrate:up
ALTER TABLE commitments.recurring_definition DROP CONSTRAINT recurring_definition_managed_by_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_managed_by_check CHECK (managed_by IN ('USER', 'SUBSCRIPTION')),
  ADD CONSTRAINT recurring_definition_managed_ref_ck CHECK ((managed_by = 'USER') = (managed_ref IS NULL));

ALTER TABLE commitments.recurring_definition_version
  ADD COLUMN indexed_amount   numeric(38,18) NULL,
  ADD COLUMN indexed_currency varchar(16)    NULL REFERENCES fx.currency (code);
ALTER TABLE commitments.recurring_definition_version
  DROP CONSTRAINT recurring_definition_version_mode_ck,
  ADD CONSTRAINT recurring_definition_version_indexed_ck CHECK (
    (indexed_amount IS NULL) = (indexed_currency IS NULL)
    AND (indexed_amount IS NULL
         OR (indexed_amount > 0 AND amount_type = 'VARIABLE' AND indexed_currency <> currency))
  ),
  ADD CONSTRAINT recurring_definition_version_mode_ck CHECK (
    (materialization_mode <> 'AUTO_CREATE' OR amount_type IN ('FIXED', 'ESTIMATED') OR indexed_amount IS NOT NULL)
    AND ((materialization_mode = 'AUTO_CREATE') = (auto_create_status IS NOT NULL))
  );

CREATE TABLE commitments.subscription (
  id                        uuid        PRIMARY KEY,
  workspace_id              uuid        NOT NULL REFERENCES iam.workspace (id),
  definition_id             uuid        NOT NULL,
  -- Referencia lógica a classification.counterparty (sin FK entre schemas, NFR-DATA-015).
  counterparty_id           uuid        NOT NULL,
  name                      text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  plan_name                 text        NULL CHECK (plan_name IS NULL OR char_length(plan_name) <= 120),
  price_currency            varchar(16) NOT NULL REFERENCES fx.currency (code),
  status                    text        NOT NULL CHECK (status IN ('TRIAL', 'ACTIVE', 'PAUSED', 'CANCELLED')),
  trial_ends_on             date        NULL,
  scheduled_cancellation_on date        NULL,
  cancelled_on              date        NULL,
  cancellation_reason       text        NULL CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 500),
  cancellation_url          text        NULL CHECK (cancellation_url IS NULL OR char_length(cancellation_url) <= 500),
  reminders_enabled         boolean     NOT NULL DEFAULT true,
  reminder_days             smallint    NOT NULL DEFAULT 3 CHECK (reminder_days BETWEEN 1 AND 30),
  price_tolerance_percent   numeric(5,2) NOT NULL DEFAULT 1.00 CHECK (price_tolerance_percent BETWEEN 0 AND 50),
  next_renewal_on           date        NULL,
  version                   integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid        NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid        NULL,
  CONSTRAINT subscription_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT subscription_definition_uk UNIQUE (definition_id),
  CONSTRAINT subscription_definition_fk FOREIGN KEY (workspace_id, definition_id)
    REFERENCES commitments.recurring_definition (workspace_id, id),
  CONSTRAINT subscription_trial_ck CHECK (status <> 'TRIAL' OR trial_ends_on IS NOT NULL),
  CONSTRAINT subscription_cancelled_ck CHECK ((status = 'CANCELLED') = (cancelled_on IS NOT NULL)),
  CONSTRAINT subscription_scheduled_ck CHECK (status <> 'CANCELLED' OR scheduled_cancellation_on IS NULL)
);
CREATE INDEX subscription_list_ix ON commitments.subscription (workspace_id, status, next_renewal_on);
CREATE INDEX subscription_counterparty_ix ON commitments.subscription (workspace_id, counterparty_id);
COMMENT ON TABLE commitments.subscription IS
  'Suscripción (commitments/subscriptions): parte comercial de una definición recurrente; id propio y UNIQUE (definition_id).';

CREATE TABLE commitments.subscription_price (
  id              uuid           PRIMARY KEY,
  workspace_id    uuid           NOT NULL REFERENCES iam.workspace (id),
  subscription_id uuid           NOT NULL,
  effective_from  date           NOT NULL,
  amount          numeric(38,18) NOT NULL CHECK (amount > 0),
  currency        varchar(16)    NOT NULL REFERENCES fx.currency (code),
  origin          text           NOT NULL CHECK (origin IN ('INITIAL', 'MANUAL', 'PROPOSAL', 'CORRECTION')),
  supersedes_id   uuid           NULL REFERENCES commitments.subscription_price (id),
  -- Propuesta aceptada que originó la entrada (referencia lógica: la propuesta se crea después de la suscripción).
  proposal_id     uuid           NULL,
  recorded_at     timestamptz    NOT NULL DEFAULT now(),
  recorded_by     uuid           NULL,
  CONSTRAINT subscription_price_subscription_fk FOREIGN KEY (workspace_id, subscription_id)
    REFERENCES commitments.subscription (workspace_id, id),
  CONSTRAINT subscription_price_supersedes_uk UNIQUE (supersedes_id),
  CONSTRAINT subscription_price_correction_ck CHECK ((origin = 'CORRECTION') = (supersedes_id IS NOT NULL)),
  CONSTRAINT subscription_price_proposal_ck CHECK (proposal_id IS NULL OR origin = 'PROPOSAL')
);
CREATE INDEX subscription_price_effective_ix ON commitments.subscription_price (subscription_id, effective_from);
COMMENT ON TABLE commitments.subscription_price IS
  'Historial de precios de una suscripción: append-only (WS-RO); una entrada reemplazada es la que otra referencia con supersedes_id.';
CREATE TRIGGER subscription_price_immutable_trg
  BEFORE UPDATE OR DELETE ON commitments.subscription_price
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER subscription_price_no_truncate_trg
  BEFORE TRUNCATE ON commitments.subscription_price
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE commitments.subscription_charge (
  id                    uuid           PRIMARY KEY,
  workspace_id          uuid           NOT NULL REFERENCES iam.workspace (id),
  subscription_id       uuid           NOT NULL,
  -- Referencias lógicas a commitments.recurring_occurrence (mismo schema) y txn.transaction (otro schema).
  occurrence_id         uuid           NOT NULL,
  occurrence_date       date           NOT NULL,
  transaction_id        uuid           NOT NULL,
  charged_amount        numeric(38,18) NOT NULL CHECK (charged_amount > 0),
  charged_currency      varchar(16)    NOT NULL REFERENCES fx.currency (code),
  price_currency_amount numeric(38,18) NULL CHECK (price_currency_amount IS NULL OR price_currency_amount > 0),
  expected_amount       numeric(38,18) NOT NULL CHECK (expected_amount > 0),
  expected_currency     varchar(16)    NOT NULL REFERENCES fx.currency (code),
  implied_rate          numeric(38,18) NULL,
  deviation_percent     numeric(9,2)   NULL,
  outcome               text           NOT NULL CHECK (outcome IN
                          ('WITHIN_TOLERANCE', 'PRICE_CHANGE_DETECTED', 'NOT_COMPARABLE', 'VOIDED')),
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT subscription_charge_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT subscription_charge_subscription_fk FOREIGN KEY (workspace_id, subscription_id)
    REFERENCES commitments.subscription (workspace_id, id)
);
-- Idempotencia de negocio: un cargo vigente por (suscripción, ocurrencia); una vinculación posterior reemplaza al VOIDED.
CREATE UNIQUE INDEX subscription_charge_occurrence_uq
  ON commitments.subscription_charge (subscription_id, occurrence_id) WHERE outcome <> 'VOIDED';
CREATE INDEX subscription_charge_txn_ix ON commitments.subscription_charge (workspace_id, transaction_id);
CREATE INDEX subscription_charge_list_ix ON commitments.subscription_charge (subscription_id, occurrence_date DESC);
COMMENT ON TABLE commitments.subscription_charge IS
  'Cargo de una suscripción vinculado a una transacción: monto cobrado, precio esperado, tasa implícita y resultado de la detección.';

CREATE TABLE commitments.subscription_price_proposal (
  id               uuid           PRIMARY KEY,
  workspace_id     uuid           NOT NULL REFERENCES iam.workspace (id),
  subscription_id  uuid           NOT NULL,
  charge_id        uuid           NOT NULL,
  effective_from   date           NOT NULL,
  previous_amount  numeric(38,18) NOT NULL CHECK (previous_amount > 0),
  proposed_amount  numeric(38,18) NOT NULL CHECK (proposed_amount > 0),
  currency         varchar(16)    NOT NULL REFERENCES fx.currency (code),
  change_percent   numeric(9,2)   NOT NULL,
  status           text           NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN')),
  decided_at       timestamptz    NULL,
  decided_by       uuid           NULL,
  event_id         uuid           NULL,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT subscription_proposal_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT subscription_proposal_subscription_fk FOREIGN KEY (workspace_id, subscription_id)
    REFERENCES commitments.subscription (workspace_id, id),
  CONSTRAINT subscription_proposal_charge_fk FOREIGN KEY (workspace_id, charge_id)
    REFERENCES commitments.subscription_charge (workspace_id, id),
  CONSTRAINT subscription_proposal_effective_uk UNIQUE (subscription_id, effective_from),
  CONSTRAINT subscription_proposal_decided_ck CHECK (
    (status IN ('ACCEPTED', 'REJECTED')) = (decided_at IS NOT NULL)
  )
);
-- A lo sumo una propuesta pendiente por suscripción.
CREATE UNIQUE INDEX subscription_proposal_pending_uq
  ON commitments.subscription_price_proposal (subscription_id) WHERE status = 'PENDING';
COMMENT ON TABLE commitments.subscription_price_proposal IS
  'Propuesta de precio creada por la detección: el EDITOR la acepta (agrega el precio al historial) o la rechaza.';

CREATE TABLE commitments.subscription_reminder (
  workspace_id    uuid        NOT NULL REFERENCES iam.workspace (id),
  subscription_id uuid        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('RENEWAL', 'TRIAL_END')),
  target_date     date        NOT NULL,
  emitted_at      timestamptz NOT NULL DEFAULT now(),
  event_id        uuid        NOT NULL,
  PRIMARY KEY (workspace_id, subscription_id, kind, target_date),
  CONSTRAINT subscription_reminder_subscription_fk FOREIGN KEY (workspace_id, subscription_id)
    REFERENCES commitments.subscription (workspace_id, id)
);
COMMENT ON TABLE commitments.subscription_reminder IS
  'Recordatorios emitidos (append-only): la clave garantiza a lo sumo uno por suscripción, tipo y fecha.';
CREATE TRIGGER subscription_reminder_immutable_trg
  BEFORE UPDATE OR DELETE ON commitments.subscription_reminder
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER subscription_reminder_no_truncate_trg
  BEFORE TRUNCATE ON commitments.subscription_reminder
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- RLS forzada por workspace (fail-closed con PF002) y grants.
ALTER TABLE commitments.subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription FORCE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_price FORCE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_charge FORCE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_price_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_price_proposal FORCE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_reminder ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments.subscription_reminder FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON commitments.subscription TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON commitments.subscription_price TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON commitments.subscription_charge TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON commitments.subscription_price_proposal TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON commitments.subscription_reminder TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA commitments FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON commitments.subscription TO pf_app;
GRANT SELECT, INSERT ON commitments.subscription_price TO pf_app;
GRANT SELECT, INSERT, UPDATE ON commitments.subscription_charge TO pf_app;
GRANT SELECT, INSERT, UPDATE ON commitments.subscription_price_proposal TO pf_app;
GRANT SELECT, INSERT ON commitments.subscription_reminder TO pf_app;

-- Purga del workspace demo (ADR-0026): recordatorios -> propuestas -> cargos -> precios -> suscripciones, y todas
-- antes que las definiciones (172) que referencian.
SELECT platform.register_workspace_scoped_table('commitments.subscription_reminder'::regclass, 161, 'DELETE');
SELECT platform.register_workspace_scoped_table('commitments.subscription_price_proposal'::regclass, 162, 'DELETE');
SELECT platform.register_workspace_scoped_table('commitments.subscription_charge'::regclass, 163, 'DELETE');
SELECT platform.register_workspace_scoped_table('commitments.subscription_price'::regclass, 164, 'DELETE');
SELECT platform.register_workspace_scoped_table('commitments.subscription'::regclass, 165, 'DELETE');

-- Consistencia del recorrido (add-lifecycle-timeline decisión 6): + Subscription.
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
    UNION ALL
    SELECT 'Subscription', s.id, s.status
      FROM commitments.subscription s WHERE s.workspace_id = platform.current_workspace_id()
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
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'commitments'
   AND table_name IN ('subscription_reminder', 'subscription_price_proposal', 'subscription_charge',
                      'subscription_price', 'subscription');
DROP TABLE commitments.subscription_reminder;
DROP TABLE commitments.subscription_price_proposal;
DROP TABLE commitments.subscription_charge;
DROP TABLE commitments.subscription_price;
DROP TABLE commitments.subscription;
ALTER TABLE commitments.recurring_definition_version
  DROP CONSTRAINT recurring_definition_version_mode_ck,
  DROP CONSTRAINT recurring_definition_version_indexed_ck,
  DROP COLUMN indexed_currency,
  DROP COLUMN indexed_amount;
ALTER TABLE commitments.recurring_definition_version
  ADD CONSTRAINT recurring_definition_version_mode_ck CHECK (
    (materialization_mode <> 'AUTO_CREATE' OR amount_type IN ('FIXED', 'ESTIMATED'))
    AND ((materialization_mode = 'AUTO_CREATE') = (auto_create_status IS NOT NULL))
  );
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_managed_ref_ck,
  DROP CONSTRAINT recurring_definition_managed_by_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_managed_by_check CHECK (managed_by = 'USER');
