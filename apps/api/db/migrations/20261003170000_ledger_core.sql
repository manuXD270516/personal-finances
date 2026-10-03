-- Núcleo contable (openspec add-ledger-core, tarea 5.1; docs/08 §5.3, §6, §10; docs/09 §13; docs/31 D10, D19;
-- ADR-0004, ADR-0006, ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator` (dueño de todo).
--
-- Crea el schema `ledger` con:
--   * ledger_account   WS: SELECT/INSERT + UPDATE(archived_at). Naturaleza y moneda sin grant de UPDATE (INV-006).
--   * journal_entry    WS-RO: asiento; `sequence` IDENTITY; idempotencia por origen+revisión+tipo (FR-LEDGER-010).
--   * posting          WS-RO: NUMERIC(38,18) ≠ 0; FK compuesta (cuenta, moneda, tipo) → ledger_account (INV-006);
--                      FKs (entry, fecha) y (workspace, entry) (INV-025); split obligatorio en nominales.
--   * entry_reversal   WS-RO: PK original_entry_id ⇒ una reversa por asiento, también bajo concurrencia (INV-008).
--   * period_lock      WS: bloqueo MENSUAL por (workspace_id, year_month) (D10); pf_app SELECT/INSERT/DELETE.
--   * balance_snapshot DRV: lectura pf_app; escritura solo pf_worker (caché reconstruible, INV-022).
-- Barreras (doble con el dominio): trigger DIFERIDO de cuadre por moneda (PF001), trigger DIFERIDO de ≥ 2 postings
-- (PF005), periodo bloqueado al insertar el asiento (PF004), inmutabilidad UPDATE/DELETE/TRUNCATE (PF003, además de
-- no otorgar esos privilegios → 42501), RLS ENABLE+FORCE por workspace (fail-closed PF002).

-- migrate:up
CREATE SCHEMA ledger;
GRANT USAGE ON SCHEMA ledger TO pf_app;

-- ---------------------------------------------------------------- ledger.ledger_account
CREATE TABLE ledger.ledger_account (
  id                uuid        PRIMARY KEY,
  workspace_id      uuid        NOT NULL REFERENCES iam.workspace (id),
  type              text        NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
  currency          varchar(16) NOT NULL REFERENCES fx.currency (code),
  system_kind       text        NULL
    CHECK (system_kind IN ('INCOME', 'EXPENSE', 'OPENING_BALANCE', 'FX_TRADING', 'ADJUSTMENTS')),
  source_account_id uuid        NULL,
  code              text        NOT NULL CHECK (length(code) BETWEEN 1 AND 100),
  created_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz NULL,
  CONSTRAINT ledger_account_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT ledger_account_id_ccy_uk UNIQUE (id, currency, type),
  CONSTRAINT ledger_account_user_ck CHECK ((type IN ('ASSET', 'LIABILITY')) = (source_account_id IS NOT NULL)),
  CONSTRAINT ledger_account_system_ck CHECK (
    (system_kind IS NULL) = (source_account_id IS NOT NULL)
    AND (system_kind IS NULL OR type = CASE system_kind WHEN 'INCOME' THEN 'INCOME' WHEN 'EXPENSE' THEN 'EXPENSE'
                                                       ELSE 'EQUITY' END)
  )
);
CREATE UNIQUE INDEX ledger_account_system_uk ON ledger.ledger_account (workspace_id, system_kind, currency)
  WHERE system_kind IS NOT NULL;
CREATE UNIQUE INDEX ledger_account_source_uk ON ledger.ledger_account (workspace_id, source_account_id)
  WHERE source_account_id IS NOT NULL;
COMMENT ON TABLE ledger.ledger_account IS
  'Plan de cuentas contables (docs/09 §2): naturaleza y moneda inmutables; solo archived_at es actualizable.';

-- ---------------------------------------------------------------- ledger.journal_entry
CREATE TABLE ledger.journal_entry (
  id                uuid        PRIMARY KEY,
  workspace_id      uuid        NOT NULL REFERENCES iam.workspace (id),
  sequence          bigint      GENERATED ALWAYS AS IDENTITY,
  entry_date        date        NOT NULL,
  entry_type        text        NOT NULL CHECK (entry_type IN ('STANDARD', 'REVERSAL', 'OPENING')),
  source_context    text        NOT NULL DEFAULT 'TRANSACTIONS' CHECK (source_context = 'TRANSACTIONS'),
  source_type       text        NOT NULL CHECK (length(source_type) BETWEEN 1 AND 64),
  source_id         uuid        NOT NULL,
  source_revision   integer     NOT NULL CHECK (source_revision >= 1),
  reverses_entry_id uuid        NULL,
  memo              text        NULL CHECK (memo IS NULL OR length(memo) <= 500),
  correlation_id    uuid        NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NULL,
  CONSTRAINT journal_entry_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT journal_entry_id_date_uk UNIQUE (id, entry_date),
  CONSTRAINT journal_entry_source_uk UNIQUE (workspace_id, source_type, source_id, source_revision, entry_type),
  CONSTRAINT journal_entry_reversal_fk FOREIGN KEY (workspace_id, reverses_entry_id)
    REFERENCES ledger.journal_entry (workspace_id, id),
  CONSTRAINT journal_entry_reversal_ck CHECK ((entry_type = 'REVERSAL') = (reverses_entry_id IS NOT NULL))
);
CREATE INDEX journal_entry_source_ix ON ledger.journal_entry (workspace_id, source_type, source_id);
CREATE INDEX journal_entry_date_ix ON ledger.journal_entry (workspace_id, entry_date);
CREATE INDEX journal_entry_sequence_ix ON ledger.journal_entry (workspace_id, sequence);
COMMENT ON TABLE ledger.journal_entry IS 'Asientos (WS-RO, INV-007): solo INSERT; la corrección es una reversa.';

-- ---------------------------------------------------------------- ledger.entry_reversal
CREATE TABLE ledger.entry_reversal (
  original_entry_id uuid        PRIMARY KEY,
  reversal_entry_id uuid        NOT NULL UNIQUE,
  workspace_id      uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_reversal_distinct_ck CHECK (original_entry_id <> reversal_entry_id),
  CONSTRAINT entry_reversal_original_fk FOREIGN KEY (workspace_id, original_entry_id)
    REFERENCES ledger.journal_entry (workspace_id, id),
  CONSTRAINT entry_reversal_reversal_fk FOREIGN KEY (workspace_id, reversal_entry_id)
    REFERENCES ledger.journal_entry (workspace_id, id)
);

-- ---------------------------------------------------------------- ledger.posting
CREATE TABLE ledger.posting (
  id                uuid           PRIMARY KEY,
  workspace_id      uuid           NOT NULL,
  journal_entry_id  uuid           NOT NULL,
  entry_date        date           NOT NULL,
  line_no           smallint       NOT NULL CHECK (line_no >= 1),
  ledger_account_id uuid           NOT NULL,
  account_type      text           NOT NULL,
  currency          varchar(16)    NOT NULL REFERENCES fx.currency (code),
  amount            numeric(38, 18) NOT NULL CHECK (amount <> 0),
  split_id          uuid           NULL,
  memo              text           NULL CHECK (memo IS NULL OR length(memo) <= 500),
  created_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT posting_entry_fk FOREIGN KEY (workspace_id, journal_entry_id)
    REFERENCES ledger.journal_entry (workspace_id, id),
  CONSTRAINT posting_entry_date_fk FOREIGN KEY (journal_entry_id, entry_date)
    REFERENCES ledger.journal_entry (id, entry_date),
  CONSTRAINT posting_account_ws_fk FOREIGN KEY (workspace_id, ledger_account_id)
    REFERENCES ledger.ledger_account (workspace_id, id),
  CONSTRAINT posting_account_ccy_fk FOREIGN KEY (ledger_account_id, currency, account_type)
    REFERENCES ledger.ledger_account (id, currency, type),
  CONSTRAINT posting_line_uk UNIQUE (journal_entry_id, line_no),
  CONSTRAINT posting_nominal_split_ck CHECK (account_type NOT IN ('INCOME', 'EXPENSE') OR split_id IS NOT NULL)
);
CREATE INDEX posting_balance_ix ON ledger.posting (workspace_id, ledger_account_id, entry_date, id) INCLUDE (amount);
CREATE INDEX posting_split_ix ON ledger.posting (workspace_id, split_id) WHERE split_id IS NOT NULL;
CREATE INDEX posting_entry_ix ON ledger.posting (journal_entry_id);
COMMENT ON COLUMN ledger.posting.amount IS 'Débito positivo, crédito negativo (FR-LEDGER-002); nunca 0 (INV-005).';

-- ---------------------------------------------------------------- ledger.period_lock (mensual, D10)
CREATE TABLE ledger.period_lock (
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  year_month   char(7)     NOT NULL CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_id    uuid        NULL,
  locked_at    timestamptz NOT NULL DEFAULT now(),
  locked_by    uuid        NULL,
  PRIMARY KEY (workspace_id, year_month)
);

-- ---------------------------------------------------------------- ledger.balance_snapshot (DRV)
CREATE TABLE ledger.balance_snapshot (
  workspace_id      uuid            NOT NULL,
  ledger_account_id uuid            NOT NULL,
  as_of_date        date            NOT NULL,
  currency          varchar(16)     NOT NULL REFERENCES fx.currency (code),
  balance           numeric(38, 18) NOT NULL,
  last_sequence     bigint          NOT NULL,
  computed_at       timestamptz     NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, ledger_account_id, as_of_date),
  CONSTRAINT balance_snapshot_account_fk FOREIGN KEY (workspace_id, ledger_account_id)
    REFERENCES ledger.ledger_account (workspace_id, id)
);
CREATE INDEX balance_snapshot_latest_ix ON ledger.balance_snapshot (workspace_id, ledger_account_id, as_of_date DESC);

-- ---------------------------------------------------------------- funciones y triggers
-- Cuadre por moneda (INV-004): diferido ⇒ se evalúa al COMMIT, una vez insertados todos los postings.
CREATE FUNCTION ledger.assert_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_ccy text;
  v_sum numeric;
BEGIN
  SELECT p.currency, sum(p.amount) INTO v_ccy, v_sum
    FROM ledger.posting p
   WHERE p.journal_entry_id = NEW.journal_entry_id
   GROUP BY p.currency
  HAVING sum(p.amount) <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED_ENTRY: entry % currency % sum %', NEW.journal_entry_id, v_ccy, v_sum
      USING ERRCODE = 'PF001';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER posting_balanced_trg AFTER INSERT ON ledger.posting
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();

-- Mínimo dos postings (INV-005). PF005 (no PF002, reservado al fail-closed de RLS: docs/31 D19).
CREATE FUNCTION ledger.assert_entry_has_postings() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF (SELECT count(*) FROM ledger.posting p WHERE p.journal_entry_id = NEW.id) < 2 THEN
    RAISE EXCEPTION 'LEDGER_ENTRY_TOO_FEW_POSTINGS: entry %', NEW.id USING ERRCODE = 'PF005';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER journal_entry_postings_trg AFTER INSERT ON ledger.journal_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_has_postings();

-- Periodo bloqueado (INV-015): mensual por (workspace_id, year_month).
CREATE FUNCTION ledger.assert_period_open() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF EXISTS (SELECT 1 FROM ledger.period_lock l
              WHERE l.workspace_id = NEW.workspace_id AND l.year_month = to_char(NEW.entry_date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'PERIOD_CLOSED: % is in a closed period', NEW.entry_date USING ERRCODE = 'PF004';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER journal_entry_period_open_trg BEFORE INSERT ON ledger.journal_entry
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_period_open();

-- Inmutabilidad (INV-007): defensa adicional a los grants (frena también al owner).
CREATE TRIGGER journal_entry_immutable_trg BEFORE UPDATE OR DELETE ON ledger.journal_entry
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER journal_entry_no_truncate_trg BEFORE TRUNCATE ON ledger.journal_entry
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER posting_immutable_trg BEFORE UPDATE OR DELETE ON ledger.posting
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER posting_no_truncate_trg BEFORE TRUNCATE ON ledger.posting
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER entry_reversal_immutable_trg BEFORE UPDATE OR DELETE ON ledger.entry_reversal
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER entry_reversal_no_truncate_trg BEFORE TRUNCATE ON ledger.entry_reversal
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- RLS (ENABLE + FORCE) y políticas
ALTER TABLE ledger.ledger_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.ledger_account FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.journal_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.journal_entry FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.entry_reversal ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.entry_reversal FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.posting ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.posting FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.period_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.period_lock FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.balance_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.balance_snapshot FORCE ROW LEVEL SECURITY;

-- pf_worker es miembro de pf_app (hereda sus políticas y grants).
CREATE POLICY ws_isolation ON ledger.ledger_account TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON ledger.period_lock TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_read ON ledger.journal_entry FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_write ON ledger.journal_entry FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_read ON ledger.posting FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_write ON ledger.posting FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_read ON ledger.entry_reversal FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_write ON ledger.entry_reversal FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_read ON ledger.balance_snapshot FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_worker ON ledger.balance_snapshot TO pf_worker
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

-- ---------------------------------------------------------------- grants (docs/08 §6)
REVOKE ALL ON ALL TABLES IN SCHEMA ledger FROM PUBLIC;
REVOKE ALL ON ledger.ledger_account, ledger.journal_entry, ledger.entry_reversal, ledger.posting,
  ledger.period_lock, ledger.balance_snapshot FROM pf_app, pf_worker;
GRANT SELECT, INSERT ON ledger.journal_entry, ledger.posting, ledger.entry_reversal TO pf_app;
GRANT SELECT, INSERT ON ledger.ledger_account TO pf_app;
GRANT UPDATE (archived_at) ON ledger.ledger_account TO pf_app;
GRANT SELECT, INSERT, DELETE ON ledger.period_lock TO pf_app;
GRANT SELECT ON ledger.balance_snapshot TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ledger.balance_snapshot TO pf_worker;

-- migrate:down
DROP SCHEMA ledger CASCADE;
