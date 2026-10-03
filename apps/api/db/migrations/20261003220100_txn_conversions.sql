-- Conversiones entre monedas (openspec add-manual-conversions, tarea 4.3; design.md decisiones 1, 7 y § Modelo de
-- datos; docs/08 §5.4; docs/09 §7). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
-- Una conversión es `kind='CONVERSION'` con legs `SOURCE` (< 0, bruto entregado), `TARGET` (> 0, neto recibido) y
-- `FEE` (< 0, fees pagados desde una tercera cuenta); los fees son splits de gasto (*Fees*) en su moneda.
--   * txn.conversion_detail  WS-RO (SELECT, INSERT): detalle de precio INMUTABLE por revisión, PK (transaction_id,
--                            revision). Editar = reversa + asiento nuevo + fila nueva con revision + 1 (FR-TRANSACTIONS-024).
--   * txn.conversion_fee     WS-RO: fees por tipo y moneda de cada revisión.
-- Segunda barrera del dominio: constraint trigger DIFERIDO `txn.assert_conversion_consistency()` (legs SOURCE/TARGET
-- en monedas distintas y coherentes con el detalle activo; INV-010: convertido + fees en origen = bruto, neto + fees en
-- destino = bruto destino).

-- migrate:up
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_kind_check;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_kind_check
  CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT', 'TRANSFER', 'CONVERSION'));

-- ---------------------------------------------------------------- txn.conversion_detail
CREATE TABLE txn.conversion_detail (
  transaction_id               uuid           NOT NULL,
  revision                     integer        NOT NULL CHECK (revision >= 1),
  workspace_id                 uuid           NOT NULL,
  source_account_id            uuid           NOT NULL,
  target_account_id            uuid           NOT NULL,
  source_amount                numeric(38,18) NOT NULL CHECK (source_amount > 0),
  source_currency              varchar(16)    NOT NULL REFERENCES fx.currency (code),
  converted_source_amount      numeric(38,18) NOT NULL CHECK (converted_source_amount > 0),
  gross_target_amount          numeric(38,18) NOT NULL CHECK (gross_target_amount > 0),
  target_amount                numeric(38,18) NOT NULL CHECK (target_amount > 0),
  target_currency              varchar(16)    NOT NULL REFERENCES fx.currency (code),
  quoted_base                  varchar(16)    NULL REFERENCES fx.currency (code),
  quoted_quote                 varchar(16)    NULL REFERENCES fx.currency (code),
  quoted_rate                  numeric(38,18) NULL CHECK (quoted_rate IS NULL OR quoted_rate > 0),
  effective_base               varchar(16)    NOT NULL REFERENCES fx.currency (code),
  effective_quote              varchar(16)    NOT NULL REFERENCES fx.currency (code),
  effective_rate               numeric(38,18) NOT NULL CHECK (effective_rate > 0),
  reference_exchange_rate_id   uuid           NULL,
  reference_base               varchar(16)    NULL REFERENCES fx.currency (code),
  reference_quote              varchar(16)    NULL REFERENCES fx.currency (code),
  reference_rate               numeric(38,18) NULL CHECK (reference_rate IS NULL OR reference_rate > 0),
  reference_source             text           NULL CHECK (reference_source IN ('MANUAL', 'PROVIDER', 'USER_CONVERSION')),
  reference_rate_type          text           NULL CHECK (reference_rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM')),
  reference_as_of              timestamptz    NULL,
  spread_pct                   numeric(38,18) NULL,
  spread_amount                numeric(38,18) NULL CHECK (spread_amount IS NULL OR spread_amount >= 0),
  spread_currency              varchar(16)    NULL REFERENCES fx.currency (code),
  quoted_rate_deviation        numeric(38,18) NULL,
  provider_counterparty_id     uuid           NULL,
  provider_name                text           NULL CHECK (provider_name IS NULL OR length(provider_name) BETWEEN 1 AND 200),
  external_ref                 text           NULL CHECK (external_ref IS NULL OR length(external_ref) <= 200),
  executed_at                  timestamptz    NOT NULL,
  created_at                   timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, revision),
  CONSTRAINT conversion_detail_ws_uk UNIQUE (workspace_id, transaction_id, revision),
  CONSTRAINT conversion_detail_tx_fk FOREIGN KEY (workspace_id, transaction_id)
    REFERENCES txn.transaction (workspace_id, id),
  CONSTRAINT conversion_detail_currencies_ck CHECK (source_currency <> target_currency),
  CONSTRAINT conversion_detail_amounts_ck CHECK (
    converted_source_amount <= source_amount AND gross_target_amount >= target_amount),
  CONSTRAINT conversion_detail_quoted_ck CHECK (
    (quoted_rate IS NULL AND quoted_base IS NULL AND quoted_quote IS NULL)
    OR (quoted_rate IS NOT NULL AND quoted_base IS NOT NULL AND quoted_quote IS NOT NULL
        AND quoted_base <> quoted_quote
        AND quoted_base IN (source_currency, target_currency) AND quoted_quote IN (source_currency, target_currency))),
  CONSTRAINT conversion_detail_effective_ck CHECK (
    effective_base <> effective_quote
    AND effective_base IN (source_currency, target_currency) AND effective_quote IN (source_currency, target_currency)),
  CONSTRAINT conversion_detail_reference_ck CHECK (
    (reference_exchange_rate_id IS NULL AND reference_rate IS NULL AND reference_base IS NULL
       AND reference_quote IS NULL AND reference_source IS NULL)
    OR (reference_exchange_rate_id IS NOT NULL AND reference_rate IS NOT NULL AND reference_source IS NOT NULL
        AND reference_base IN (source_currency, target_currency)
        AND reference_quote IN (source_currency, target_currency) AND reference_base <> reference_quote)),
  -- El spread solo existe con tasa cotizada y referencia (fx/conversion-pricing: no determinable ⇒ NULL).
  CONSTRAINT conversion_detail_spread_ck CHECK (
    (spread_pct IS NULL AND spread_amount IS NULL AND spread_currency IS NULL)
    OR (spread_pct IS NOT NULL AND spread_amount IS NOT NULL AND spread_currency IS NOT NULL
        AND quoted_rate IS NOT NULL AND reference_rate IS NOT NULL))
);
CREATE INDEX conversion_detail_pair_idx ON txn.conversion_detail
  (workspace_id, source_currency, target_currency, executed_at);
COMMENT ON TABLE txn.conversion_detail IS
  'ConversionDetail inmutable por revisión (INV-011/INV-012): nunca se recalcula con tasas nuevas; editar = revisión nueva.';

-- ---------------------------------------------------------------- txn.conversion_fee
CREATE TABLE txn.conversion_fee (
  id                   uuid           PRIMARY KEY,
  workspace_id         uuid           NOT NULL,
  transaction_id       uuid           NOT NULL,
  revision             integer        NOT NULL,
  fee_no               smallint       NOT NULL CHECK (fee_no >= 1),
  fee_type             text           NOT NULL CHECK (fee_type IN ('PROVIDER', 'NETWORK', 'BANK', 'TAX', 'OTHER')),
  amount               numeric(38,18) NOT NULL CHECK (amount > 0),
  currency             varchar(16)    NOT NULL REFERENCES fx.currency (code),
  paid_from_account_id uuid           NULL,
  split_id             uuid           NOT NULL,
  CONSTRAINT conversion_fee_no_uk UNIQUE (transaction_id, revision, fee_no),
  CONSTRAINT conversion_fee_detail_fk FOREIGN KEY (workspace_id, transaction_id, revision)
    REFERENCES txn.conversion_detail (workspace_id, transaction_id, revision),
  CONSTRAINT conversion_fee_split_fk FOREIGN KEY (workspace_id, split_id)
    REFERENCES txn.transaction_split (workspace_id, id)
);
CREATE INDEX conversion_fee_tx_idx ON txn.conversion_fee (workspace_id, transaction_id, revision);

-- ---------------------------------------------------------------- INV-010 / legs en BD (constraint trigger diferido)
CREATE FUNCTION txn.assert_conversion_consistency() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_tx        uuid;
  v_kind      text;
  v_revision  integer;
  v_detail    txn.conversion_detail%ROWTYPE;
  v_src_acct  uuid;
  v_src_amt   numeric;
  v_src_ccy   text;
  v_tgt_acct  uuid;
  v_tgt_amt   numeric;
  v_tgt_ccy   text;
  v_sources   integer;
  v_targets   integer;
  v_others    integer;
  v_fees_src  numeric;
  v_fees_tgt  numeric;
BEGIN
  IF TG_TABLE_NAME = 'transaction' THEN
    v_tx := NEW.id;
  ELSE
    v_tx := NEW.transaction_id;
  END IF;
  SELECT t.kind, t.revision INTO v_kind, v_revision FROM txn.transaction t
   WHERE t.workspace_id = NEW.workspace_id AND t.id = v_tx;
  IF v_kind IS DISTINCT FROM 'CONVERSION' THEN
    RETURN NULL;
  END IF;
  SELECT count(*) FILTER (WHERE l.role = 'SOURCE' AND l.amount < 0),
         count(*) FILTER (WHERE l.role = 'TARGET' AND l.amount > 0),
         count(*) FILTER (WHERE l.role NOT IN ('SOURCE', 'TARGET', 'FEE')
                            OR (l.role = 'SOURCE' AND l.amount >= 0)
                            OR (l.role = 'TARGET' AND l.amount <= 0)
                            OR (l.role = 'FEE' AND l.amount >= 0))
    INTO v_sources, v_targets, v_others
    FROM txn.transaction_leg l
   WHERE l.workspace_id = NEW.workspace_id AND l.transaction_id = v_tx AND l.superseded_in_revision IS NULL;
  SELECT l.account_id, -l.amount, l.currency INTO v_src_acct, v_src_amt, v_src_ccy FROM txn.transaction_leg l
   WHERE l.workspace_id = NEW.workspace_id AND l.transaction_id = v_tx AND l.superseded_in_revision IS NULL
     AND l.role = 'SOURCE' LIMIT 1;
  SELECT l.account_id, l.amount, l.currency INTO v_tgt_acct, v_tgt_amt, v_tgt_ccy FROM txn.transaction_leg l
   WHERE l.workspace_id = NEW.workspace_id AND l.transaction_id = v_tx AND l.superseded_in_revision IS NULL
     AND l.role = 'TARGET' LIMIT 1;
  SELECT * INTO v_detail FROM txn.conversion_detail d
   WHERE d.workspace_id = NEW.workspace_id AND d.transaction_id = v_tx AND d.revision <= v_revision
   ORDER BY d.revision DESC LIMIT 1;
  IF v_sources <> 1 OR v_targets <> 1 OR v_others <> 0 OR v_src_ccy = v_tgt_ccy OR NOT FOUND
     OR v_detail.source_account_id <> v_src_acct OR v_detail.target_account_id <> v_tgt_acct
     OR v_detail.source_amount <> v_src_amt OR v_detail.target_amount <> v_tgt_amt
     OR v_detail.source_currency <> v_src_ccy OR v_detail.target_currency <> v_tgt_ccy THEN
    RAISE EXCEPTION 'conversion % is inconsistent with its legs (sources %, targets %, others %)',
      v_tx, v_sources, v_targets, v_others
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_conversion_consistency_ck';
  END IF;
  SELECT COALESCE(sum(f.amount) FILTER (WHERE f.currency = v_detail.source_currency AND f.paid_from_account_id IS NULL), 0),
         COALESCE(sum(f.amount) FILTER (WHERE f.currency = v_detail.target_currency AND f.paid_from_account_id IS NULL), 0)
    INTO v_fees_src, v_fees_tgt
    FROM txn.conversion_fee f
   WHERE f.workspace_id = NEW.workspace_id AND f.transaction_id = v_tx AND f.revision = v_detail.revision;
  IF v_detail.converted_source_amount + v_fees_src <> v_detail.source_amount
     OR v_detail.target_amount + v_fees_tgt <> v_detail.gross_target_amount THEN
    RAISE EXCEPTION 'conversion % violates INV-010 (fees do not reconcile gross and net amounts)', v_tx
      USING ERRCODE = '23514', CONSTRAINT = 'conversion_detail_inv010_ck';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_conversion_consistency_tx
  AFTER INSERT OR UPDATE ON txn.transaction
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_conversion_consistency();
CREATE CONSTRAINT TRIGGER transaction_conversion_consistency_leg
  AFTER INSERT OR UPDATE ON txn.transaction_leg
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_conversion_consistency();
CREATE CONSTRAINT TRIGGER conversion_detail_consistency
  AFTER INSERT ON txn.conversion_detail
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_conversion_consistency();
CREATE CONSTRAINT TRIGGER conversion_fee_consistency
  AFTER INSERT ON txn.conversion_fee
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_conversion_consistency();
REVOKE ALL ON FUNCTION txn.assert_conversion_consistency() FROM PUBLIC;

-- ---------------------------------------------------------------- RLS (WS-RO) y grants
ALTER TABLE txn.conversion_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.conversion_detail FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.conversion_fee ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.conversion_fee FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON txn.conversion_detail TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON txn.conversion_fee TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON txn.conversion_detail, txn.conversion_fee FROM PUBLIC;
REVOKE ALL ON txn.conversion_detail, txn.conversion_fee FROM pf_app, pf_worker;
-- INV-011/INV-012: el detalle nunca se modifica ni se borra (solo SELECT/INSERT).
GRANT SELECT, INSERT ON txn.conversion_detail, txn.conversion_fee TO pf_app;

-- migrate:down
DROP TRIGGER conversion_fee_consistency ON txn.conversion_fee;
DROP TRIGGER conversion_detail_consistency ON txn.conversion_detail;
DROP TRIGGER transaction_conversion_consistency_leg ON txn.transaction_leg;
DROP TRIGGER transaction_conversion_consistency_tx ON txn.transaction;
DROP FUNCTION txn.assert_conversion_consistency();
DROP TABLE txn.conversion_fee;
DROP TABLE txn.conversion_detail;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_kind_check;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_kind_check
  CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT', 'TRANSFER'));
