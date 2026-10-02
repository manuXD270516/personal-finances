-- migrate:up
-- SPIKE-02 (throwaway): subconjunto de docs/08-data-model.md §1.4, §10.1–10.3.

CREATE SCHEMA platform;
CREATE SCHEMA iam;
CREATE SCHEMA fx;
CREATE SCHEMA ledger;

-- Fail-closed (ADR-0023): current_setting SIN missing_ok.
--  * conexión nueva sin contexto  -> ERROR unrecognized configuration parameter
--  * conexión reutilizada del pool tras un SET LOCAL ya terminado -> '' -> ERROR invalid input syntax for type uuid
CREATE FUNCTION platform.current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT current_setting('app.workspace_id')::uuid $$;

CREATE FUNCTION platform.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'PF003';
END $$;

CREATE TABLE iam.workspace (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fx.currency (
  code  varchar(16) PRIMARY KEY,
  kind  text NOT NULL CHECK (kind IN ('FIAT','CRYPTO','COMMODITY','CUSTOM')),
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 18)
);

CREATE TABLE ledger.ledger_account (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES iam.workspace(id),
  type              text NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  currency          varchar(16) NOT NULL REFERENCES fx.currency(code),
  system_kind       text CHECK (system_kind IN ('INCOME','EXPENSE','OPENING_BALANCE','FX_TRADING','ADJUSTMENTS')),
  source_account_id uuid,
  code              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  CONSTRAINT ledger_account_ws_id_uk  UNIQUE (workspace_id, id),
  CONSTRAINT ledger_account_id_ccy_uk UNIQUE (id, currency, type),
  CONSTRAINT ledger_account_user_ck CHECK ((type IN ('ASSET','LIABILITY')) = (source_account_id IS NOT NULL))
);

CREATE TABLE ledger.journal_entry (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES iam.workspace(id),
  sequence          bigint GENERATED ALWAYS AS IDENTITY,
  entry_date        date NOT NULL,
  entry_type        text NOT NULL CHECK (entry_type IN ('STANDARD','REVERSAL','OPENING')),
  source_type       text NOT NULL,
  source_id         uuid NOT NULL,
  source_revision   int  NOT NULL,
  reverses_entry_id uuid,
  memo              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entry_ws_id_uk   UNIQUE (workspace_id, id),
  CONSTRAINT journal_entry_id_date_uk UNIQUE (id, entry_date),
  CONSTRAINT journal_entry_reversal_fk FOREIGN KEY (workspace_id, reverses_entry_id)
    REFERENCES ledger.journal_entry (workspace_id, id),
  CONSTRAINT journal_entry_reversal_ck CHECK ((entry_type = 'REVERSAL') = (reverses_entry_id IS NOT NULL))
);

CREATE TABLE ledger.posting (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL,
  journal_entry_id  uuid NOT NULL,
  entry_date        date NOT NULL,
  line_no           smallint NOT NULL,
  ledger_account_id uuid NOT NULL,
  account_type      text NOT NULL,
  currency          varchar(16) NOT NULL REFERENCES fx.currency(code),
  amount            numeric(38,18) NOT NULL CHECK (amount <> 0),
  split_id          uuid,
  memo              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_entry_fk FOREIGN KEY (workspace_id, journal_entry_id)
    REFERENCES ledger.journal_entry (workspace_id, id),
  CONSTRAINT posting_entry_date_fk FOREIGN KEY (journal_entry_id, entry_date)
    REFERENCES ledger.journal_entry (id, entry_date),
  CONSTRAINT posting_account_ws_fk FOREIGN KEY (workspace_id, ledger_account_id)
    REFERENCES ledger.ledger_account (workspace_id, id),
  CONSTRAINT posting_account_ccy_fk FOREIGN KEY (ledger_account_id, currency, account_type)
    REFERENCES ledger.ledger_account (id, currency, type),
  CONSTRAINT posting_line_uk UNIQUE (journal_entry_id, line_no),
  CONSTRAINT posting_nominal_split_ck CHECK (account_type NOT IN ('INCOME','EXPENSE') OR split_id IS NOT NULL)
);
CREATE INDEX posting_balance_ix
  ON ledger.posting (workspace_id, ledger_account_id, entry_date, id) INCLUDE (amount);

-- Zero-sum por moneda (INV-004), diferido al COMMIT
CREATE FUNCTION ledger.assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_ccy text; v_sum numeric;
BEGIN
  SELECT currency, sum(amount) INTO v_ccy, v_sum
  FROM ledger.posting
  WHERE journal_entry_id = NEW.journal_entry_id
  GROUP BY currency
  HAVING sum(amount) <> 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED_ENTRY: entry % currency % sum %',
      NEW.journal_entry_id, v_ccy, v_sum USING ERRCODE = 'PF001';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER posting_balanced_trg
  AFTER INSERT ON ledger.posting
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();

-- Mínimo dos postings por entry (INV-005)
CREATE FUNCTION ledger.assert_entry_has_postings() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM ledger.posting WHERE journal_entry_id = NEW.id) < 2 THEN
    RAISE EXCEPTION 'LEDGER_ENTRY_TOO_FEW_POSTINGS: entry %', NEW.id USING ERRCODE = 'PF002';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER journal_entry_postings_trg
  AFTER INSERT ON ledger.journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_has_postings();

-- Inmutabilidad (INV-007): defensa adicional a los grants
CREATE TRIGGER posting_immutable_trg
  BEFORE UPDATE OR DELETE ON ledger.posting
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER posting_no_truncate_trg
  BEFORE TRUNCATE ON ledger.posting
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER journal_entry_immutable_trg
  BEFORE UPDATE OR DELETE ON ledger.journal_entry
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();

-- RLS (ADR-0023): ENABLE + FORCE, política sin TO (aplica también al owner)
ALTER TABLE ledger.ledger_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.ledger_account FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.journal_entry  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.journal_entry  FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.posting        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.posting        FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON ledger.ledger_account
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON ledger.journal_entry
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON ledger.posting
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Grants (docs/08 §6): pf_app solo SELECT/INSERT en tablas append-only
GRANT USAGE ON SCHEMA platform, iam, fx, ledger TO pf_app;
GRANT EXECUTE ON FUNCTION platform.current_workspace_id() TO pf_app;
GRANT SELECT ON iam.workspace, fx.currency TO pf_app;
GRANT SELECT, INSERT ON ledger.journal_entry, ledger.posting TO pf_app;
GRANT SELECT, INSERT, UPDATE (archived_at) ON ledger.ledger_account TO pf_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.posting, ledger.journal_entry FROM PUBLIC, pf_app;

INSERT INTO fx.currency (code, kind, scale) VALUES
  ('BOB','FIAT',2), ('USD','FIAT',2), ('USDT','CRYPTO',6), ('BTC','CRYPTO',8), ('ETH','CRYPTO',18);

-- migrate:down
DROP SCHEMA ledger CASCADE;
DROP SCHEMA fx CASCADE;
DROP SCHEMA iam CASCADE;
DROP SCHEMA platform CASCADE;
