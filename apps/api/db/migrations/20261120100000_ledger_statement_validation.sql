-- Validación por sentencia de los invariantes del ledger y de los splits, diferida al confirmar (ADR-0034, D447;
-- openspec stabilize-import-persist-perf, tarea 7.6; docs/09 barreras de la base de datos, docs/08 tablas internas).
-- Expand, sin tocar datos, columnas ni contratos: el código N-1 funciona igual con los dos mecanismos.
--
-- Hasta ahora cuatro disparadores de restricción DEFERRABLE INITIALLY DEFERRED POR FILA validaban el cuadre por moneda
-- (INV-004, PF001), el mínimo de dos postings (INV-005, PF005) y Σ splits = monto (INV-021, 23514): cada fila
-- insertada encolaba un evento y cada confirmación ejecutaba una función plpgsql por fila (~25 000 por import de 5 000
-- filas). Ahora:
--   * recolectores `AFTER … REFERENCING … FOR EACH STATEMENT` encolan las claves tocadas por la sentencia en una cola
--     UNLOGGED por transacción (`xact = pg_current_xact_id()`) y una fila centinela por transacción;
--   * un único disparador de restricción diferido por contexto, sobre el centinela, valida POR CONJUNTO todas las
--     claves de la cola al confirmar (o al `SET CONSTRAINTS ALL IMMEDIATE`) y limpia cola y centinela.
-- La evaluación sigue siendo al confirmar (admite los estados intermedios), con los mismos SQLSTATE, restricción y
-- formato de mensajes. PostgreSQL 18 no admite disparadores de restricción por sentencia ni con tablas de transición
-- (de ahí el centinela). Las funciones viejas se conservan sin uso para que `migrate:down` restaure los disparadores
-- por fila. Funciones SECURITY INVOKER con `search_path` fijo (la RLS de las tablas base aplica a la validación).
-- Las colas no tienen `workspace_id`: sus filas viven solo dentro de la transacción que las escribe, por lo que no
-- entran en `platform.workspace_scoped_table` ni en el export; su RLS (forzada, `xact = pg_current_xact_id()`) cumple
-- la regla de catálogo y aísla las colas entre sesiones.

-- migrate:up
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------- LEDGER: cola, centinela y recolectores
CREATE UNLOGGED TABLE ledger.pending_entry_check (
  xact             xid8 NOT NULL,
  journal_entry_id uuid NOT NULL,
  PRIMARY KEY (xact, journal_entry_id)
);
CREATE UNLOGGED TABLE ledger.pending_check_sentinel (
  xact xid8 PRIMARY KEY
);

CREATE FUNCTION ledger.collect_entries_from_entry() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  INSERT INTO ledger.pending_entry_check (xact, journal_entry_id)
  SELECT pg_current_xact_id(), d.id FROM (SELECT DISTINCT n.id FROM new_rows n) d
  ON CONFLICT DO NOTHING;
  INSERT INTO ledger.pending_check_sentinel (xact)
  SELECT pg_current_xact_id() WHERE EXISTS (SELECT 1 FROM new_rows)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;

CREATE FUNCTION ledger.collect_entries_from_posting() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  INSERT INTO ledger.pending_entry_check (xact, journal_entry_id)
  SELECT pg_current_xact_id(), d.journal_entry_id FROM (SELECT DISTINCT n.journal_entry_id FROM new_rows n) d
  ON CONFLICT DO NOTHING;
  INSERT INTO ledger.pending_check_sentinel (xact)
  SELECT pg_current_xact_id() WHERE EXISTS (SELECT 1 FROM new_rows)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;

-- Valida por conjunto las claves de la transacción: primero los asientos con menos de dos postings (PF005) y después
-- los descuadres por moneda (PF001), como el orden en que hoy se disparan los eventos (asiento antes que sus postings).
CREATE FUNCTION ledger.validate_pending_entries() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_xact  xid8 := pg_current_xact_id();
  v_entry uuid;
  v_ccy   text;
  v_sum   numeric;
BEGIN
  -- Cada consulta agrega por conjunto dentro de un subselect con OFFSET 0 y ordena fuera: sin esa barrera, el LIMIT 1 hace
  -- que el planificador prefiera recorrer en orden todo el índice de postings (las colas no tienen estadísticas).
  SELECT f.journal_entry_id INTO v_entry
    FROM (
      SELECT q.journal_entry_id
        FROM ledger.pending_entry_check q
        LEFT JOIN ledger.posting p ON p.journal_entry_id = q.journal_entry_id
       WHERE q.xact = v_xact
       GROUP BY q.journal_entry_id
      HAVING count(p.id) < 2
      OFFSET 0) f
   ORDER BY f.journal_entry_id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'LEDGER_ENTRY_TOO_FEW_POSTINGS: entry %', v_entry USING ERRCODE = 'PF005';
  END IF;
  SELECT f.journal_entry_id, f.currency, f.total INTO v_entry, v_ccy, v_sum
    FROM (
      SELECT p.journal_entry_id, p.currency, sum(p.amount) AS total
        FROM ledger.pending_entry_check q
        JOIN ledger.posting p ON p.journal_entry_id = q.journal_entry_id
       WHERE q.xact = v_xact
       GROUP BY p.journal_entry_id, p.currency
      HAVING sum(p.amount) <> 0
      OFFSET 0) f
   ORDER BY f.journal_entry_id, f.currency
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED_ENTRY: entry % currency % sum %', v_entry, v_ccy, v_sum
      USING ERRCODE = 'PF001';
  END IF;
  DELETE FROM ledger.pending_entry_check WHERE xact = v_xact;
  DELETE FROM ledger.pending_check_sentinel WHERE xact = v_xact;
  RETURN NULL;
END
$$;

CREATE TRIGGER journal_entry_collect_trg AFTER INSERT ON ledger.journal_entry
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION ledger.collect_entries_from_entry();
CREATE TRIGGER posting_collect_trg AFTER INSERT ON ledger.posting
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION ledger.collect_entries_from_posting();
CREATE CONSTRAINT TRIGGER pending_check_sentinel_validate_trg AFTER INSERT ON ledger.pending_check_sentinel
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.validate_pending_entries();

-- ---------------------------------------------------------------- TRANSACTIONS: cola, centinela y recolectores
CREATE UNLOGGED TABLE txn.pending_splits_check (
  xact           xid8 NOT NULL,
  transaction_id uuid NOT NULL,
  PRIMARY KEY (xact, transaction_id)
);
CREATE UNLOGGED TABLE txn.pending_check_sentinel (
  xact xid8 PRIMARY KEY
);

CREATE FUNCTION txn.collect_splits_from_transaction_insert() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  INSERT INTO txn.pending_splits_check (xact, transaction_id)
  SELECT pg_current_xact_id(), d.id FROM (SELECT DISTINCT n.id FROM new_rows n) d
  ON CONFLICT DO NOTHING;
  INSERT INTO txn.pending_check_sentinel (xact)
  SELECT pg_current_xact_id() WHERE EXISTS (SELECT 1 FROM new_rows)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;

-- Reemplaza a `UPDATE OF amount`, que no admite tablas de transición: encola solo las filas cuyo monto cambió.
CREATE FUNCTION txn.collect_splits_from_transaction_update() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  INSERT INTO txn.pending_splits_check (xact, transaction_id)
  SELECT pg_current_xact_id(), d.id
    FROM (SELECT DISTINCT n.id FROM new_rows n JOIN old_rows o ON o.id = n.id
           WHERE o.amount IS DISTINCT FROM n.amount) d
  ON CONFLICT DO NOTHING;
  INSERT INTO txn.pending_check_sentinel (xact)
  SELECT pg_current_xact_id()
   WHERE EXISTS (SELECT 1 FROM new_rows n JOIN old_rows o ON o.id = n.id WHERE o.amount IS DISTINCT FROM n.amount)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;

CREATE FUNCTION txn.collect_splits_from_split() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  INSERT INTO txn.pending_splits_check (xact, transaction_id)
  SELECT pg_current_xact_id(), d.transaction_id FROM (SELECT DISTINCT n.transaction_id FROM new_rows n) d
  ON CONFLICT DO NOTHING;
  INSERT INTO txn.pending_check_sentinel (xact)
  SELECT pg_current_xact_id() WHERE EXISTS (SELECT 1 FROM new_rows)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;

-- Misma lógica por tipo que `txn.assert_splits_sum()` de 20261011100100_txn_loan_kinds.sql (INV-021 ampliado):
-- INCOME/EXPENSE/REFUND: Σ splits vigentes = monto; LOAN_PAYMENT: monto − principal del desglose; LOAN_DISBURSEMENT:
-- monto − leg TARGET vigente (la comisión retenida). El resto de los tipos no lleva splits que sumar.
CREATE FUNCTION txn.validate_pending_splits() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_xact     xid8 := pg_current_xact_id();
  v_tx       uuid;
  v_sum      numeric;
  v_expected numeric;
BEGIN
  -- Misma forma que en LEDGER: las claves de la cola mandan (LATERAL con OFFSET 0 impide que el planificador aplane el
  -- subselect y empiece por las tablas grandes) y la suma de splits es una subconsulta por clave (transaction_split_tx_idx).
  SELECT x.id, x.sum_splits, x.expected INTO v_tx, v_sum, v_expected
    FROM (
      SELECT t.id,
             CASE t.kind
               WHEN 'LOAN_PAYMENT' THEN
                 t.amount - COALESCE((t.loan_payment_breakdown ->> 'principal')::numeric, 0)
               WHEN 'LOAN_DISBURSEMENT' THEN
                 t.amount - COALESCE((
                   SELECT l.amount FROM txn.transaction_leg l
                    WHERE l.workspace_id = t.workspace_id AND l.transaction_id = t.id
                      AND l.role = 'TARGET' AND l.superseded_in_revision IS NULL
                    LIMIT 1), t.amount)
               ELSE t.amount
             END AS expected,
             (SELECT COALESCE(sum(s.amount), 0) FROM txn.transaction_split s
               WHERE s.workspace_id = t.workspace_id AND s.transaction_id = t.id
                 AND s.superseded_in_revision IS NULL) AS sum_splits
        FROM txn.pending_splits_check c
       CROSS JOIN LATERAL (
              SELECT t0.id, t0.workspace_id, t0.kind, t0.amount, t0.loan_payment_breakdown
                FROM txn.transaction t0
               WHERE t0.id = c.transaction_id
                 AND t0.kind IN ('INCOME', 'EXPENSE', 'REFUND', 'LOAN_PAYMENT', 'LOAN_DISBURSEMENT')
               OFFSET 0) t
       WHERE c.xact = v_xact
       OFFSET 0
    ) x
   WHERE x.sum_splits <> x.expected
   ORDER BY x.id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'splits of transaction % sum % but the expected amount is %', v_tx, v_sum, v_expected
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum_ck';
  END IF;
  DELETE FROM txn.pending_splits_check WHERE xact = v_xact;
  DELETE FROM txn.pending_check_sentinel WHERE xact = v_xact;
  RETURN NULL;
END
$$;

CREATE TRIGGER transaction_collect_insert_trg AFTER INSERT ON txn.transaction
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION txn.collect_splits_from_transaction_insert();
CREATE TRIGGER transaction_collect_update_trg AFTER UPDATE ON txn.transaction
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION txn.collect_splits_from_transaction_update();
CREATE TRIGGER transaction_split_collect_insert_trg AFTER INSERT ON txn.transaction_split
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION txn.collect_splits_from_split();
CREATE TRIGGER transaction_split_collect_update_trg AFTER UPDATE ON txn.transaction_split
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION txn.collect_splits_from_split();
CREATE CONSTRAINT TRIGGER pending_check_sentinel_validate_trg AFTER INSERT ON txn.pending_check_sentinel
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.validate_pending_splits();

-- ---------------------------------------------------------------- RLS forzada y grants de las colas
ALTER TABLE ledger.pending_entry_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.pending_entry_check FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.pending_check_sentinel ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.pending_check_sentinel FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.pending_splits_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.pending_splits_check FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.pending_check_sentinel ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.pending_check_sentinel FORCE ROW LEVEL SECURITY;

-- Para todos los roles (también el dueño forzado): cada sesión solo ve y escribe las claves de su propia transacción.
CREATE POLICY current_xact ON ledger.pending_entry_check
  USING (xact = pg_current_xact_id()) WITH CHECK (xact = pg_current_xact_id());
CREATE POLICY current_xact ON ledger.pending_check_sentinel
  USING (xact = pg_current_xact_id()) WITH CHECK (xact = pg_current_xact_id());
CREATE POLICY current_xact ON txn.pending_splits_check
  USING (xact = pg_current_xact_id()) WITH CHECK (xact = pg_current_xact_id());
CREATE POLICY current_xact ON txn.pending_check_sentinel
  USING (xact = pg_current_xact_id()) WITH CHECK (xact = pg_current_xact_id());

REVOKE ALL ON ledger.pending_entry_check, ledger.pending_check_sentinel,
              txn.pending_splits_check, txn.pending_check_sentinel FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON ledger.pending_entry_check, ledger.pending_check_sentinel,
                                txn.pending_splits_check, txn.pending_check_sentinel TO pf_app;
REVOKE ALL ON FUNCTION ledger.collect_entries_from_entry(), ledger.collect_entries_from_posting(),
                       ledger.validate_pending_entries(), txn.collect_splits_from_transaction_insert(),
                       txn.collect_splits_from_transaction_update(), txn.collect_splits_from_split(),
                       txn.validate_pending_splits() FROM PUBLIC;

-- ---------------------------------------------------------------- se eliminan los disparadores por fila
-- `lock_timeout` (arriba): DROP TRIGGER toma un bloqueo exclusivo breve sobre las cuatro tablas base; la migración
-- corre en la ventana de deploy y falla rápido, sin esperar, si hay una transacción larga abierta sobre ellas.
DROP TRIGGER posting_balanced_trg ON ledger.posting;
DROP TRIGGER journal_entry_postings_trg ON ledger.journal_entry;
DROP TRIGGER transaction_splits_sum_tx ON txn.transaction;
DROP TRIGGER transaction_splits_sum_split ON txn.transaction_split;

-- migrate:down
SET LOCAL lock_timeout = '5s';

DROP TRIGGER journal_entry_collect_trg ON ledger.journal_entry;
DROP TRIGGER posting_collect_trg ON ledger.posting;
DROP TRIGGER transaction_collect_insert_trg ON txn.transaction;
DROP TRIGGER transaction_collect_update_trg ON txn.transaction;
DROP TRIGGER transaction_split_collect_insert_trg ON txn.transaction_split;
DROP TRIGGER transaction_split_collect_update_trg ON txn.transaction_split;

-- Los disparadores por fila vuelven tal como estaban (20261003170000_ledger_core.sql y 20261003200000_txn_transactions_core.sql).
CREATE CONSTRAINT TRIGGER posting_balanced_trg AFTER INSERT ON ledger.posting
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();
CREATE CONSTRAINT TRIGGER journal_entry_postings_trg AFTER INSERT ON ledger.journal_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_has_postings();
CREATE CONSTRAINT TRIGGER transaction_splits_sum_tx
  AFTER INSERT OR UPDATE OF amount ON txn.transaction
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_splits_sum();
CREATE CONSTRAINT TRIGGER transaction_splits_sum_split
  AFTER INSERT OR UPDATE ON txn.transaction_split
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_splits_sum();

DROP TABLE ledger.pending_check_sentinel;
DROP TABLE ledger.pending_entry_check;
DROP TABLE txn.pending_check_sentinel;
DROP TABLE txn.pending_splits_check;
DROP FUNCTION ledger.collect_entries_from_entry();
DROP FUNCTION ledger.collect_entries_from_posting();
DROP FUNCTION ledger.validate_pending_entries();
DROP FUNCTION txn.collect_splits_from_transaction_insert();
DROP FUNCTION txn.collect_splits_from_transaction_update();
DROP FUNCTION txn.collect_splits_from_split();
DROP FUNCTION txn.validate_pending_splits();
