-- FX: compra y venta del mercado paralelo como tipos de tasa propios (openspec add-market-rate-providers, decisión
-- del owner 2026-10-03; design.md decisión 29). Expand, no destructiva: solo AMPLÍA los CHECK de tipo de tasa con
-- `PARALLEL_BUY` y `PARALLEL_SELL` (las filas existentes siguen siendo válidas). Se ejecuta con `pf_migrator`.
--
--   * fx.exchange_rate.rate_type         los providers registran compra/venta además de la mediana `PARALLEL`.
--   * fx.rate_preference.rate_type       un workspace puede preferir explícitamente la compra o la venta.
--   * txn.conversion_detail.reference_rate_type  la referencia de una conversión puede ser una tasa de esos tipos
--     (solo si la preferencia del par lo pide: sin tipo resuelto nunca se eligen).

-- migrate:up
ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_rate_type_check;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL'));

ALTER TABLE fx.rate_preference DROP CONSTRAINT rate_preference_rate_type_check;
ALTER TABLE fx.rate_preference ADD CONSTRAINT rate_preference_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL'));

ALTER TABLE txn.conversion_detail DROP CONSTRAINT conversion_detail_reference_rate_type_check;
ALTER TABLE txn.conversion_detail ADD CONSTRAINT conversion_detail_reference_rate_type_check
  CHECK (reference_rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM', 'PARALLEL_BUY', 'PARALLEL_SELL'));

-- migrate:down
-- Solo revierte si no hay filas con los tipos nuevos (fx.exchange_rate es append-only: no se borran tasas).
ALTER TABLE txn.conversion_detail DROP CONSTRAINT conversion_detail_reference_rate_type_check;
ALTER TABLE txn.conversion_detail ADD CONSTRAINT conversion_detail_reference_rate_type_check
  CHECK (reference_rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM'));

ALTER TABLE fx.rate_preference DROP CONSTRAINT rate_preference_rate_type_check;
ALTER TABLE fx.rate_preference ADD CONSTRAINT rate_preference_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM'));

ALTER TABLE fx.exchange_rate DROP CONSTRAINT exchange_rate_rate_type_check;
ALTER TABLE fx.exchange_rate ADD CONSTRAINT exchange_rate_rate_type_check
  CHECK (rate_type IN ('OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM'));
