-- Núcleo de TRANSACTIONS (openspec add-transaction-recording, tarea 4.1; docs/08 §5.4 con los ajustes de design.md
-- § Modelo de datos y D27). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * transaction               WS: SELECT/INSERT/UPDATE (sin DELETE, NFR-DATA-012). CHECKs de INV-023 y de kind.
--   * transaction_leg           WS: SELECT/INSERT/UPDATE (solo para marcar `superseded_in_revision`).
--   * transaction_split         WS: SELECT/INSERT/UPDATE; constraint trigger DIFERIDO Σ splits vigentes = monto (INV-021).
--   * split_tag                 WS: tabla de enlace (SELECT/INSERT/DELETE).
--   * transaction_journal_link  WS-RO: append-only (SELECT/INSERT): cadena de asientos/reversas por revisión.
-- Sin FKs cross-schema salvo workspace → iam.workspace y moneda → fx.currency (NFR-DATA-015). La búsqueda de texto
-- usa `search_text` normalizado por la aplicación (sin `unaccent`/`pg_trgm`: design.md § Implementación).

-- migrate:up
CREATE SCHEMA txn;
GRANT USAGE ON SCHEMA txn TO pf_app;

-- ---------------------------------------------------------------- txn.transaction
CREATE TABLE txn.transaction (
  id                       uuid          PRIMARY KEY,
  workspace_id             uuid          NOT NULL REFERENCES iam.workspace (id),
  kind                     text          NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT')),
  status                   text          NOT NULL CHECK (status IN ('PENDING', 'POSTED', 'CLEARED', 'RECONCILED', 'VOIDED')),
  transaction_date         date          NOT NULL,
  posting_date             date          NULL,
  account_id               uuid          NOT NULL,
  amount                   numeric(38,18) NOT NULL CHECK (amount > 0),
  currency                 varchar(16)   NOT NULL REFERENCES fx.currency (code),
  adjustment_direction     text          NULL CHECK (adjustment_direction IN ('INCREASE', 'DECREASE')),
  description              text          NULL CHECK (description IS NULL OR length(description) <= 500),
  notes                    text          NULL CHECK (notes IS NULL OR length(notes) <= 4000),
  counterparty_id          uuid          NULL,
  payment_method           text          NULL CHECK (payment_method IN
                             ('CASH', 'QR', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'DIGITAL_WALLET', 'OTHER')),
  source                   text          NOT NULL DEFAULT 'MANUAL' CHECK (source IN
                             ('MANUAL', 'IMPORT', 'RECURRING', 'DEBT', 'GOAL', 'SYSTEM')),
  external_ref_namespace   text          NULL CHECK (external_ref_namespace IS NULL OR length(external_ref_namespace) <= 100),
  external_ref_id          text          NULL CHECK (external_ref_id IS NULL OR length(external_ref_id) <= 200),
  refund_of_transaction_id uuid          NULL,
  adjustment_reason        text          NULL CHECK (adjustment_reason IS NULL OR length(adjustment_reason) BETWEEN 1 AND 500),
  confirmed_refund_excess  boolean       NOT NULL DEFAULT false,
  revision                 integer       NOT NULL DEFAULT 1 CHECK (revision >= 1),
  active_entry_id          uuid          NULL,
  voided_at                timestamptz   NULL,
  void_reason              text          NULL CHECK (void_reason IS NULL OR length(void_reason) <= 500),
  search_text              text          NOT NULL DEFAULT '',
  version                  integer       NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT transaction_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT transaction_refund_fk FOREIGN KEY (workspace_id, refund_of_transaction_id)
    REFERENCES txn.transaction (workspace_id, id),
  -- INV-023: PENDING y VOIDED nunca tienen asiento activo; el resto siempre.
  CONSTRAINT transaction_active_entry_ck CHECK ((status IN ('PENDING', 'VOIDED')) = (active_entry_id IS NULL)),
  CONSTRAINT transaction_voided_ck CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CONSTRAINT transaction_adjustment_ck CHECK (
    (kind = 'ADJUSTMENT') = (adjustment_reason IS NOT NULL AND adjustment_direction IS NOT NULL)),
  CONSTRAINT transaction_refund_kind_ck CHECK (refund_of_transaction_id IS NULL OR kind = 'REFUND'),
  CONSTRAINT transaction_external_ref_ck CHECK ((external_ref_namespace IS NULL) = (external_ref_id IS NULL))
);
CREATE INDEX transaction_ws_date_idx ON txn.transaction (workspace_id, transaction_date DESC, id DESC);
CREATE INDEX transaction_ws_account_date_idx ON txn.transaction (workspace_id, account_id, transaction_date DESC, id DESC);
CREATE INDEX transaction_refund_idx ON txn.transaction (workspace_id, refund_of_transaction_id)
  WHERE refund_of_transaction_id IS NOT NULL;
COMMENT ON TABLE txn.transaction IS
  'Transacciones del usuario (transactions/transaction-recording). Nunca se borran: anular = VOIDED + reversa.';
COMMENT ON COLUMN txn.transaction.search_text IS
  'descripción + notas normalizadas por la aplicación (minúsculas, sin acentos) para `q`.';

-- ---------------------------------------------------------------- txn.transaction_leg
CREATE TABLE txn.transaction_leg (
  id                     uuid           PRIMARY KEY,
  workspace_id           uuid           NOT NULL,
  transaction_id         uuid           NOT NULL,
  account_id             uuid           NOT NULL,
  account_nature         text           NOT NULL CHECK (account_nature IN ('ASSET', 'LIABILITY')),
  role                   text           NOT NULL CHECK (role IN ('MAIN', 'SOURCE', 'TARGET', 'FEE')),
  amount                 numeric(38,18) NOT NULL CHECK (amount <> 0),
  currency               varchar(16)    NOT NULL REFERENCES fx.currency (code),
  transaction_date       date           NOT NULL,
  revision               integer        NOT NULL CHECK (revision >= 1),
  superseded_in_revision integer        NULL CHECK (superseded_in_revision IS NULL OR superseded_in_revision > revision),
  CONSTRAINT transaction_leg_tx_fk FOREIGN KEY (workspace_id, transaction_id)
    REFERENCES txn.transaction (workspace_id, id)
);
CREATE INDEX transaction_leg_tx_idx ON txn.transaction_leg (workspace_id, transaction_id);
CREATE INDEX transaction_leg_register_idx ON txn.transaction_leg
  (workspace_id, account_id, transaction_date DESC, transaction_id DESC) WHERE superseded_in_revision IS NULL;

-- ---------------------------------------------------------------- txn.transaction_split
CREATE TABLE txn.transaction_split (
  id                     uuid           PRIMARY KEY,
  workspace_id           uuid           NOT NULL,
  transaction_id         uuid           NOT NULL,
  position               integer        NOT NULL CHECK (position >= 0),
  amount                 numeric(38,18) NOT NULL CHECK (amount > 0),
  currency               varchar(16)    NOT NULL REFERENCES fx.currency (code),
  category_id            uuid           NOT NULL,
  counterparty_id        uuid           NULL,
  memo                   text           NULL CHECK (memo IS NULL OR length(memo) <= 500),
  revision               integer        NOT NULL CHECK (revision >= 1),
  superseded_in_revision integer        NULL,
  CONSTRAINT transaction_split_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT transaction_split_tx_fk FOREIGN KEY (workspace_id, transaction_id)
    REFERENCES txn.transaction (workspace_id, id)
);
CREATE INDEX transaction_split_tx_idx ON txn.transaction_split (workspace_id, transaction_id)
  WHERE superseded_in_revision IS NULL;
CREATE INDEX transaction_split_category_idx ON txn.transaction_split (workspace_id, category_id)
  WHERE superseded_in_revision IS NULL;

-- ---------------------------------------------------------------- txn.split_tag
CREATE TABLE txn.split_tag (
  workspace_id uuid NOT NULL,
  split_id     uuid NOT NULL,
  tag_id       uuid NOT NULL,
  PRIMARY KEY (workspace_id, split_id, tag_id),
  CONSTRAINT split_tag_split_fk FOREIGN KEY (workspace_id, split_id)
    REFERENCES txn.transaction_split (workspace_id, id)
);

-- ---------------------------------------------------------------- txn.transaction_journal_link
CREATE TABLE txn.transaction_journal_link (
  workspace_id     uuid        NOT NULL,
  transaction_id   uuid        NOT NULL,
  revision         integer     NOT NULL CHECK (revision >= 1),
  journal_entry_id uuid        NOT NULL,
  link_type        text        NOT NULL CHECK (link_type IN ('POSTED', 'REVERSAL')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, journal_entry_id),
  CONSTRAINT transaction_journal_link_tx_fk FOREIGN KEY (workspace_id, transaction_id)
    REFERENCES txn.transaction (workspace_id, id)
);
CREATE INDEX transaction_journal_link_tx_idx ON txn.transaction_journal_link (workspace_id, transaction_id, revision);

-- ---------------------------------------------------------------- INV-021 en BD (constraint trigger diferido)
CREATE FUNCTION txn.assert_splits_sum() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_tx    uuid;
  v_kind  text;
  v_total numeric;
  v_sum   numeric;
BEGIN
  IF TG_TABLE_NAME = 'transaction' THEN
    v_tx := NEW.id;
  ELSE
    v_tx := NEW.transaction_id;
  END IF;
  SELECT t.kind, t.amount INTO v_kind, v_total FROM txn.transaction t
   WHERE t.workspace_id = NEW.workspace_id AND t.id = v_tx;
  IF v_kind IS NULL OR v_kind NOT IN ('INCOME', 'EXPENSE', 'REFUND') THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(s.amount), 0) INTO v_sum FROM txn.transaction_split s
   WHERE s.workspace_id = NEW.workspace_id AND s.transaction_id = v_tx AND s.superseded_in_revision IS NULL;
  IF v_sum <> v_total THEN
    RAISE EXCEPTION 'splits of transaction % sum % but the amount is %', v_tx, v_sum, v_total
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum_ck';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_splits_sum_tx
  AFTER INSERT OR UPDATE OF amount ON txn.transaction
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_splits_sum();
CREATE CONSTRAINT TRIGGER transaction_splits_sum_split
  AFTER INSERT OR UPDATE ON txn.transaction_split
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_splits_sum();

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE txn.transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.transaction FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.transaction_leg ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.transaction_leg FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.transaction_split ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.transaction_split FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.split_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.split_tag FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.transaction_journal_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.transaction_journal_link FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON txn.transaction TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON txn.transaction_leg TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON txn.transaction_split TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON txn.split_tag TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON txn.transaction_journal_link TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA txn FROM PUBLIC;
REVOKE ALL ON txn.transaction, txn.transaction_leg, txn.transaction_split, txn.split_tag, txn.transaction_journal_link
  FROM pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON txn.transaction, txn.transaction_leg, txn.transaction_split TO pf_app;
GRANT SELECT, INSERT, DELETE ON txn.split_tag TO pf_app;
GRANT SELECT, INSERT ON txn.transaction_journal_link TO pf_app;
REVOKE ALL ON FUNCTION txn.assert_splits_sum() FROM PUBLIC;

-- migrate:down
DROP SCHEMA txn CASCADE;
