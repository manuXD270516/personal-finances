-- Observaciones de las conversiones propias (openspec add-conversion-cost-analysis, decisión 6; docs/41 D231, D249;
-- cierra D26). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * fx.exchange_rate        columnas NULLABLES `conversion_transaction_id` y `conversion_revision` (la conversión y
--                             su revisión que originó la observación `source = USER_CONVERSION`), coherencia origen ⇔
--                             conversión (CHECK) e índice único parcial por (workspace, conversión, revisión): la
--                             idempotencia de negocio de la observación. Sin FK a `txn.transaction` (NFR-DATA-015).
--   * fx.assert_supersede_consistency  una observación de una revisión nueva reemplaza a la de la revisión anterior de
--                             la MISMA conversión aunque cambien el par o la vigencia (una revisión puede cambiar
--                             monedas o fecha); el resto de las tasas conserva la regla original.
--   * fx.rate_withdrawal      WS, APPEND-ONLY: marca de una observación como anulada (la conversión se anuló) sin
--                             tocar la tasa (INV-011). PK = tasa; una sola marca por observación. RLS forzada;
--                             solo `pf_worker` inserta (el consumidor de FX), `pf_app` lee.

-- migrate:up

-- ---------------------------------------------------------------- fx.exchange_rate (referencia a la conversión)
ALTER TABLE fx.exchange_rate
  ADD COLUMN conversion_transaction_id uuid    NULL,
  ADD COLUMN conversion_revision       integer NULL;

ALTER TABLE fx.exchange_rate
  ADD CONSTRAINT exchange_rate_conversion_ck CHECK (
    (source = 'USER_CONVERSION') = (conversion_transaction_id IS NOT NULL)
    AND (conversion_transaction_id IS NULL) = (conversion_revision IS NULL)
    AND (conversion_revision IS NULL OR conversion_revision >= 1)
  );

-- Una observación por conversión y revisión (idempotencia: el mismo hecho procesado varias veces registra una sola).
CREATE UNIQUE INDEX exchange_rate_conversion_uk ON fx.exchange_rate
  (workspace_id, conversion_transaction_id, conversion_revision) WHERE conversion_transaction_id IS NOT NULL;

COMMENT ON COLUMN fx.exchange_rate.conversion_transaction_id IS
  'Conversión propia que originó la observación (source = USER_CONVERSION; D231). Sin FK cross-schema.';
COMMENT ON COLUMN fx.exchange_rate.conversion_revision IS
  'Revisión del ConversionDetail de la conversión observada (1 en el registro; +1 por cada revisión financiera).';

-- ---------------------------------------------------------------- reemplazo de observaciones entre revisiones
CREATE OR REPLACE FUNCTION fx.assert_supersede_consistency() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_old fx.exchange_rate%ROWTYPE;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_old FROM fx.exchange_rate WHERE id = NEW.supersedes_id;
  IF NEW.source = 'USER_CONVERSION' THEN
    -- Una revisión financiera puede cambiar el par o la ejecución: solo se exige que sea la MISMA conversión.
    IF NOT FOUND OR v_old.source <> 'USER_CONVERSION'
       OR v_old.conversion_transaction_id IS DISTINCT FROM NEW.conversion_transaction_id THEN
      RAISE EXCEPTION 'observation % must replace an observation of the same conversion (%)', NEW.id, NEW.supersedes_id
        USING ERRCODE = '23514', CONSTRAINT = 'exchange_rate_supersede_consistency_ck';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT FOUND OR v_old.base_currency <> NEW.base_currency OR v_old.quote_currency <> NEW.quote_currency
     OR v_old.rate_type <> NEW.rate_type OR v_old.as_of <> NEW.as_of THEN
    RAISE EXCEPTION 'rate % must keep pair, type and as_of of the superseded rate %', NEW.id, NEW.supersedes_id
      USING ERRCODE = '23514', CONSTRAINT = 'exchange_rate_supersede_consistency_ck';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- fx.rate_withdrawal
CREATE TABLE fx.rate_withdrawal (
  exchange_rate_id uuid        PRIMARY KEY,
  workspace_id     uuid        NOT NULL REFERENCES iam.workspace (id),
  transaction_id   uuid        NOT NULL,
  reason           text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  withdrawn_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_withdrawal_rate_fk FOREIGN KEY (workspace_id, exchange_rate_id)
    REFERENCES fx.exchange_rate (workspace_id, id)
);
CREATE INDEX rate_withdrawal_ws_tx_idx ON fx.rate_withdrawal (workspace_id, transaction_id);
COMMENT ON TABLE fx.rate_withdrawal IS
  'Marca append-only de una observación USER_CONVERSION como anulada (la conversión se anuló); no modifica la tasa (INV-011).';

-- Solo observaciones de conversión propia pueden marcarse (segunda barrera del dominio).
CREATE FUNCTION fx.assert_rate_withdrawal_target() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fx.exchange_rate r
     WHERE r.id = NEW.exchange_rate_id AND r.source = 'USER_CONVERSION'
       AND r.conversion_transaction_id = NEW.transaction_id
  ) THEN
    RAISE EXCEPTION 'fx rate % is not an observation of conversion %', NEW.exchange_rate_id, NEW.transaction_id
      USING ERRCODE = '23514', CONSTRAINT = 'rate_withdrawal_target_ck';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rate_withdrawal_target BEFORE INSERT ON fx.rate_withdrawal
  FOR EACH ROW EXECUTE FUNCTION fx.assert_rate_withdrawal_target();
REVOKE ALL ON FUNCTION fx.assert_rate_withdrawal_target() FROM PUBLIC;

-- ---------------------------------------------------------------- RLS, grants y registro
ALTER TABLE fx.rate_withdrawal ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx.rate_withdrawal FORCE ROW LEVEL SECURITY;
-- Lectura por workspace (la API y, por herencia de `pf_app`, el worker); inserta solo el worker del consumidor de FX.
CREATE POLICY rate_withdrawal_read ON fx.rate_withdrawal FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY rate_withdrawal_insert ON fx.rate_withdrawal FOR INSERT TO pf_worker
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON fx.rate_withdrawal FROM PUBLIC;
REVOKE ALL ON fx.rate_withdrawal FROM pf_app, pf_worker;
GRANT SELECT ON fx.rate_withdrawal TO pf_app;
GRANT INSERT ON fx.rate_withdrawal TO pf_worker;

-- Purga del workspace demo (ADR-0026): antes que `fx.exchange_rate` (orden 160), que la referencia.
SELECT platform.register_workspace_scoped_table('fx.rate_withdrawal'::regclass, 150, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'fx' AND table_name = 'rate_withdrawal';
DROP TABLE fx.rate_withdrawal;
DROP FUNCTION fx.assert_rate_withdrawal_target();
CREATE OR REPLACE FUNCTION fx.assert_supersede_consistency() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_old fx.exchange_rate%ROWTYPE;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_old FROM fx.exchange_rate WHERE id = NEW.supersedes_id;
  IF NOT FOUND OR v_old.base_currency <> NEW.base_currency OR v_old.quote_currency <> NEW.quote_currency
     OR v_old.rate_type <> NEW.rate_type OR v_old.as_of <> NEW.as_of THEN
    RAISE EXCEPTION 'rate % must keep pair, type and as_of of the superseded rate %', NEW.id, NEW.supersedes_id
      USING ERRCODE = '23514', CONSTRAINT = 'exchange_rate_supersede_consistency_ck';
  END IF;
  RETURN NEW;
END;
$$;
DROP INDEX fx.exchange_rate_conversion_uk;
ALTER TABLE fx.exchange_rate
  DROP CONSTRAINT exchange_rate_conversion_ck,
  DROP COLUMN conversion_revision,
  DROP COLUMN conversion_transaction_id;
