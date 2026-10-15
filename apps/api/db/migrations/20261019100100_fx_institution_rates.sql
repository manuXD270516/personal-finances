-- FX: tasas por institución (openspec add-exchange-house-rate-providers, tarea 4.1; design.md § Plan de migración;
-- FR-FX-009, FR-FX-002). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * fx.exchange_rate.institution_code  columna nueva NULA: código de catálogo de la institución que publicó la
--     cotización (solo `BANK_BUY` / `BANK_SELL` de un provider por institución; las demás tasas la dejan en NULL).
--   * fx.exchange_rate / fx.rate_preference / txn.conversion_detail  se AMPLÍAN los CHECK de tipo de tasa con `BANK_BUY` y
--     `BANK_SELL` (compra y venta "desde el lado del owner", D39; las filas existentes siguen siendo válidas).
--   * fx.exchange_rate / fx.provider_run  el CHECK de `provider` admite los ids de providers por institución
--     `INSTRATE_<NOMBRE>` (los ids reales se fijan en el ADR de sus fuentes tras verificar sus términos de uso; la
--     aplicación decide cuáles se habilitan, la BD solo exige la forma).
--   * Índice único de idempotencia de las tasas de provider: se crea el nuevo con `COALESCE(institution_code, '')` ANTES
--     de retirar el anterior. Las filas existentes tienen `institution_code` NULL, así que el nuevo índice acepta
--     exactamente lo que aceptaba el anterior; el anterior debe retirarse en la misma migración porque rechazaría dos
--     instituciones con el mismo provider, par, tipo y vigencia.
-- Los CHECK ampliados se agregan NOT VALID y se validan aparte (expand sin bloqueos largos).

-- migrate:up
ALTER TABLE fx.exchange_rate ADD COLUMN institution_code text NULL;

-- Solo las tasas de un lado de una institución llevan código y toda tasa de provider de ese tipo lo exige.
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_institution_ck CHECK (
  (institution_code IS NULL OR (
      institution_code ~ '^[A-Z0-9-]{2,40}$' AND rate_type IN ('BANK_BUY', 'BANK_SELL')))
  AND (rate_type NOT IN ('BANK_BUY', 'BANK_SELL') OR source <> 'PROVIDER' OR institution_code IS NOT NULL)
) NOT VALID;
ALTER TABLE fx.exchange_rate VALIDATE CONSTRAINT exchange_rate_institution_ck;

COMMENT ON COLUMN fx.exchange_rate.institution_code IS
  'Código de catálogo de la institución que publicó la cotización (BANK_BUY/BANK_SELL de un provider por institución); NULL en el resto.';

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_rate_type_check;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET', 'BANK_BUY', 'BANK_SELL')) NOT VALID;
ALTER TABLE fx.exchange_rate VALIDATE CONSTRAINT exchange_rate_rate_type_check;

ALTER TABLE fx.rate_preference DROP CONSTRAINT rate_preference_rate_type_check;
ALTER TABLE fx.rate_preference ADD CONSTRAINT rate_preference_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET', 'BANK_BUY', 'BANK_SELL')) NOT VALID;
ALTER TABLE fx.rate_preference VALIDATE CONSTRAINT rate_preference_rate_type_check;

ALTER TABLE txn.conversion_detail DROP CONSTRAINT conversion_detail_reference_rate_type_check;
ALTER TABLE txn.conversion_detail ADD CONSTRAINT conversion_detail_reference_rate_type_check
  CHECK (reference_rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET', 'BANK_BUY', 'BANK_SELL')) NOT VALID;
ALTER TABLE txn.conversion_detail VALIDATE CONSTRAINT conversion_detail_reference_rate_type_check;

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_provider_ck;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_provider_ck
  CHECK (provider IS NULL OR provider IN ('PARALELO_BO', 'DOLARAPI_BO')
         OR provider ~ '^CRYPTO_[A-Z0-9_]{1,32}$' OR provider ~ '^INSTRATE_[A-Z0-9_]{1,32}$') NOT VALID;
ALTER TABLE fx.exchange_rate VALIDATE CONSTRAINT exchange_rate_provider_ck;

ALTER TABLE fx.provider_run DROP CONSTRAINT provider_run_provider_check;
ALTER TABLE fx.provider_run ADD CONSTRAINT provider_run_provider_check
  CHECK (provider IN ('PARALELO_BO', 'DOLARAPI_BO')
         OR provider ~ '^CRYPTO_[A-Z0-9_]{1,32}$' OR provider ~ '^INSTRATE_[A-Z0-9_]{1,32}$') NOT VALID;
ALTER TABLE fx.provider_run VALIDATE CONSTRAINT provider_run_provider_check;

-- Idempotencia: una tasa de provider por (workspace, provider, par, tipo, institución, vigencia).
CREATE UNIQUE INDEX exchange_rate_provider_inst_uk ON fx.exchange_rate
  (workspace_id, provider, base_currency, quote_currency, rate_type, COALESCE(institution_code, ''), as_of)
  WHERE provider IS NOT NULL;
DROP INDEX fx.exchange_rate_provider_uk;

-- Estado por institución: la última tasa aceptada de cada (institución, tipo, par) de un provider.
CREATE INDEX exchange_rate_institution_ix ON fx.exchange_rate
  (workspace_id, provider, institution_code, base_currency, quote_currency, rate_type, as_of DESC)
  WHERE institution_code IS NOT NULL;

-- migrate:down
-- Solo revierte si no hay filas con BANK_BUY/BANK_SELL, institution_code ni providers INSTRATE_ (fx.exchange_rate es
-- append-only: no se borran tasas).
DROP INDEX fx.exchange_rate_institution_ix;
CREATE UNIQUE INDEX exchange_rate_provider_uk ON fx.exchange_rate
  (workspace_id, provider, base_currency, quote_currency, rate_type, as_of) WHERE provider IS NOT NULL;
DROP INDEX fx.exchange_rate_provider_inst_uk;

ALTER TABLE fx.provider_run DROP CONSTRAINT provider_run_provider_check;
ALTER TABLE fx.provider_run ADD CONSTRAINT provider_run_provider_check
  CHECK (provider IN ('PARALELO_BO', 'DOLARAPI_BO') OR provider ~ '^CRYPTO_[A-Z0-9_]{1,32}$');

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_provider_ck;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_provider_ck
  CHECK (provider IS NULL OR provider IN ('PARALELO_BO', 'DOLARAPI_BO') OR provider ~ '^CRYPTO_[A-Z0-9_]{1,32}$');

ALTER TABLE txn.conversion_detail DROP CONSTRAINT conversion_detail_reference_rate_type_check;
ALTER TABLE txn.conversion_detail ADD CONSTRAINT conversion_detail_reference_rate_type_check
  CHECK (reference_rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET'));

ALTER TABLE fx.rate_preference DROP CONSTRAINT rate_preference_rate_type_check;
ALTER TABLE fx.rate_preference ADD CONSTRAINT rate_preference_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET'));

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_rate_type_check;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL', 'MARKET'));

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_institution_ck;
ALTER TABLE fx.exchange_rate DROP COLUMN institution_code;
