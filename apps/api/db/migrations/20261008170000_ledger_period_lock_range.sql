-- LEDGER: bloqueo por RANGO del periodo financiero (openspec add-month-closing, tarea 4.1; ADR-0028; design.md
-- decisiones 6 y 7). Expand + contract en la misma migración (tabla pequeña, sin consumidores externos). Se ejecuta
-- con `pf_migrator`.
--
--   * `ledger.period_lock` gana `period_start`/`period_end` (rango CERRADO [inicio, fin] del periodo financiero). Las
--     filas existentes (mes calendario, Phase 1) se rellenan desde `year_month`. El primer periodo cerrado de un
--     workspace se escribe con `period_start = '-infinity'` (abierto hacia atrás).
--   * CHECK `period_end >= period_start` y exclusión gist: dos periodos cerrados del mismo workspace no se solapan.
--   * `ledger.assert_period_open()` evalúa `entry_date BETWEEN period_start AND period_end` (PF004, mismo mensaje).
--   * La PK (workspace_id, year_month) se mantiene: `year_month` es la ETIQUETA del periodo (idempotencia de `lock`).
-- Requiere btree_gist (creada por 20261008120000).

-- migrate:up
ALTER TABLE ledger.period_lock ADD COLUMN period_start date NULL;
ALTER TABLE ledger.period_lock ADD COLUMN period_end date NULL;

UPDATE ledger.period_lock
   SET period_start = to_date(year_month || '-01', 'YYYY-MM-DD'),
       period_end   = (to_date(year_month || '-01', 'YYYY-MM-DD') + INTERVAL '1 month' - INTERVAL '1 day')::date
 WHERE period_start IS NULL;

ALTER TABLE ledger.period_lock ALTER COLUMN period_start SET NOT NULL;
ALTER TABLE ledger.period_lock ALTER COLUMN period_end SET NOT NULL;

ALTER TABLE ledger.period_lock
  ADD CONSTRAINT period_lock_range_ck CHECK (period_end >= period_start),
  ADD CONSTRAINT period_lock_no_overlap_ex
    EXCLUDE USING gist (workspace_id WITH =, daterange(period_start, period_end, '[]') WITH &&);

COMMENT ON COLUMN ledger.period_lock.period_start IS
  'Inicio del rango cerrado (inclusive); -infinity = abierto hacia atrás (primer periodo cerrado del workspace).';
COMMENT ON COLUMN ledger.period_lock.period_end IS 'Fin del rango cerrado (inclusive).';

-- Periodo bloqueado (INV-015): por rango del periodo financiero (ADR-0028).
CREATE OR REPLACE FUNCTION ledger.assert_period_open() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF EXISTS (SELECT 1 FROM ledger.period_lock l
              WHERE l.workspace_id = NEW.workspace_id AND NEW.entry_date BETWEEN l.period_start AND l.period_end) THEN
    RAISE EXCEPTION 'PERIOD_CLOSED: % is in a closed period', NEW.entry_date USING ERRCODE = 'PF004';
  END IF;
  RETURN NEW;
END
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION ledger.assert_period_open() RETURNS trigger
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
ALTER TABLE ledger.period_lock DROP CONSTRAINT period_lock_no_overlap_ex;
ALTER TABLE ledger.period_lock DROP CONSTRAINT period_lock_range_ck;
ALTER TABLE ledger.period_lock DROP COLUMN period_end;
ALTER TABLE ledger.period_lock DROP COLUMN period_start;
