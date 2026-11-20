# ADR-0034: Validación por sentencia de los invariantes del ledger y de los splits, diferida al confirmar

- Estado: Propuesto (2026-11-20; pasa a Aceptado cuando se cumple la Validación)
- Fecha: 2026-11-20
- Decisores: Owner (Product/Tech Lead)
- Relacionado: D404 ([docs/64](../64-import-persist-perf-decisions.md)), D445 y D447 ([docs/69](../69-import-persist-perf-decisions-2.md)), pregunta 4 de [docs/68](../68-import-persist-perf-questions-2.md); evidencia en [docs/67](../67-import-persist-perf-findings.md) §5; D403, D405, D443, D444 y D446; [ADR-0004](0004-ledger-model-double-entry.md) (doble entrada), [ADR-0023](0023-multi-tenancy-and-row-level-security.md) (RLS); docs/ARCHITECTURE.md §4.1; migraciones `20261003170000_ledger_core.sql`, `20261003200000_txn_transactions_core.sql` y `20261011100100_txn_loan_kinds.sql`; OpenSpec change `stabilize-import-persist-perf` (tarea 7.6) y capabilities `ledger/journal-posting`, `transactions/splits`, `transactions/transaction-recording`

## Contexto y problema

La persistencia del import de 5 000 filas (fila del host de TC-IMPORTS-CSV-029) debe quedar en ≤ 20 s en 5 nightlies programados seguidos (D403). La causa dominante de los rojos es la contención de CPU con el relay y los consumidores (H3, ≈ 35 %), pero el owner decidió no regularlos (D443) ni cambiar el runner (D444). La única palanca que queda con respaldo en los datos son los disparadores de integridad del ledger.

La medición de D445 (runs 44689564779 y 44689580742, `track_functions = 'pl'` y lectura de `pg_stat_user_functions`, docs/67 §5) da un peso de los disparadores del 26 al 60 % de la persistencia (mediana 43 %). D404 exigía al menos 25 %. Tres funciones explican casi todo:

| Función | Disparadores que la llaman | Llamadas por import | Tiempo propio (Xeon, repetición 1) |
|---|---|---|---|
| `txn.assert_splits_sum` | `transaction_splits_sum_tx` y `transaction_splits_sum_split` | 10 000 | 3,6 s (4,7 s de 5,6 en el EPYC 7763) |
| `ledger.assert_entry_balanced` | `posting_balanced_trg` | 10 002 | 2,2 s |
| `ledger.assert_entry_has_postings` | `journal_entry_postings_trg` | 5 001 | 1,4 s |

`txn.assert_transfer_consistency` y `ledger.assert_period_open` suman menos de 0,3 s y quedan fuera.

Los cuatro disparadores ya son **disparadores de restricción `DEFERRABLE INITIALLY DEFERRED` por fila**: cada fila insertada encola un evento, y al confirmar cada evento ejecuta su función plpgsql, que vuelve a consultar el asiento o la transacción completa. Con 200 filas por lote, cada confirmación ejecuta unas 1 000 funciones que validan lo mismo dos veces (la transacción y su split; cada asiento, una vez por posting).

El problema es cómo bajar ese costo **sin cambiar la semántica**: un asiento descuadrado o sin postings, o unos splits que no suman, DEBEN (MUST) seguir revirtiendo la transacción de base de datos al confirmar, con los mismos SQLSTATE (`PF001`, `PF005`, `23514` con la restricción `transaction_splits_sum_ck`). También deben seguir valiendo el ledger append-only, la RLS forzada, las escrituras por fila y por conjunto, `SET CONSTRAINTS ALL IMMEDIATE` (importador de portabilidad) y las migraciones solo expand.

## Drivers de decisión

- **Semántica idéntica:** la barrera de la base de datos es la segunda defensa de INV-004, INV-005 e INV-021 (ARCHITECTURE §4.1). Se evalúa al confirmar, admite estados intermedios dentro de la transacción (TC-LEDGER-BALANCE-002 inserta posting a posting) y revierte el lote entero si falla (D404).
- **Costo proporcional a las sentencias, no a las filas:** el import escribe por conjunto (`INSERT … SELECT FROM unnest`, change 52). La validación debería hacer una consulta por conjunto, no una función por fila.
- **Escrituras en varias sentencias:** el asiento se inserta antes que sus postings (FK), la transacción antes que sus splits, y una revisión cambia el monto, reemplaza los splits vigentes e inserta los nuevos en sentencias separadas. Si se valida al final de cada sentencia, esos estados intermedios fallan.
- **Restricciones de PostgreSQL 18** (verificadas en 18.6, ver Notas): un disparador de restricción solo puede ser `AFTER … FOR EACH ROW` y no admite `REFERENCING`. Un disparador con tablas de transición no admite varios eventos (`INSERT OR UPDATE`) ni lista de columnas (`UPDATE OF amount`).
- **Sin efecto lateral en el resto del sistema:** sin cambios de contrato ni de código de aplicación, sin conexiones nuevas (D249), sin `synchronous_commit` asíncrono (D405) y sin regular el relay (D443).
- **Reversible:** la migración debe poder volver a los disparadores por fila.

## Opciones consideradas

1. **Recolector por sentencia con tablas de transición y un validador diferido por transacción** (recomendada).
2. **Disparadores por sentencia con tablas de transición que validan al final de la sentencia**, sin diferir.
3. **Disparadores de restricción `DEFERRABLE INITIALLY DEFERRED` por fila**, como hoy pero con funciones más baratas.
4. **Validación solo en la aplicación**, sin la barrera de la base de datos.
5. **Mantener lo actual.**

(Un disparador de restricción por sentencia o con tablas de transición, que sería la forma directa de «por sentencia y diferido», no existe en PostgreSQL 18: la gramática lo rechaza. Ver Notas.)

## Decisión

Se propone la **opción 1** para las tres comprobaciones medidas (cuadre por moneda, al menos dos postings y suma de los splits). Las demás funciones de disparador no cambian.

**Mecanismo, por contexto (LEDGER y TRANSACTIONS, cada uno en su schema):**

1. **Cola de claves pendientes**: una tabla `UNLOGGED` sin `workspace_id`.
   - `ledger.pending_entry_check (xact xid8, journal_entry_id uuid, PRIMARY KEY (xact, journal_entry_id))`.
   - `txn.pending_splits_check (xact xid8, transaction_id uuid, PRIMARY KEY (xact, transaction_id))`.

   Sus filas existen solo dentro de la transacción que las escribe: el validador las borra antes de confirmar y un `ROLLBACK` las descarta. Por eso no se registran en `platform.workspace_scoped_table` ni en el export.
2. **Centinela**: una tabla `UNLOGGED` con una fila por transacción que todavía tiene validaciones pendientes.
   - `ledger.pending_check_sentinel (xact xid8 PRIMARY KEY)`.
   - `txn.pending_check_sentinel (xact xid8 PRIMARY KEY)`.
3. **Recolectores**: disparadores `AFTER … REFERENCING NEW TABLE … FOR EACH STATEMENT`, uno por tabla y evento, porque PostgreSQL no admite varios eventos con tablas de transición. Cada uno inserta en la cola las claves distintas de la sentencia (`INSERT … SELECT DISTINCT … ON CONFLICT DO NOTHING`) y el centinela de la transacción (`ON CONFLICT DO NOTHING`).
   - `ledger.journal_entry` `AFTER INSERT` encola `id`.
   - `ledger.posting` `AFTER INSERT` encola `journal_entry_id`.
   - `txn.transaction` `AFTER INSERT` encola `id`.
   - `txn.transaction` `AFTER UPDATE` (`REFERENCING OLD TABLE … NEW TABLE …`) encola solo las filas cuyo `amount` cambió (`IS DISTINCT FROM`). Reemplaza al `UPDATE OF amount` actual, que no admite tablas de transición.
   - `txn.transaction_split` `AFTER INSERT` y `AFTER UPDATE` encolan `transaction_id`.
4. **Validador**: un disparador de restricción `AFTER INSERT ON <schema>.pending_check_sentinel DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`. Corre **una vez por transacción** al confirmar (o al ejecutarse `SET CONSTRAINTS ALL IMMEDIATE`) y valida por conjunto todas las claves de la cola de `xact = pg_current_xact_id()`.
   - LEDGER valida primero los asientos con menos de dos postings (`PF005`) y después los descuadres por moneda (`PF001`), en el orden en que hoy se disparan los eventos.
   - TRANSACTIONS reproduce la lógica vigente de `txn.assert_splits_sum`, también la de `LOAN_PAYMENT` y `LOAN_DISBURSEMENT` (`20261011100100_txn_loan_kinds.sql`). Devuelve el mismo SQLSTATE, la misma restricción y el mismo formato de mensaje, con la primera clave en orden determinista.
   - Al terminar, borra sus filas de la cola y del centinela. Si una escritura posterior de la misma transacción vuelve a encolar claves, el centinela se inserta de nuevo y se valida otra vez.
5. **Seguridad**:
   - Las funciones siguen siendo `SECURITY INVOKER` con `search_path` fijo, como hoy. Las consultas de validación corren con el rol de la sesión y su RLS. No se usa `SECURITY DEFINER`, porque las políticas son `TO pf_app` y el dueño forzado no vería filas.
   - La cola y el centinela tienen RLS habilitada y forzada con una política para todos los roles `USING (xact = pg_current_xact_id()) WITH CHECK (xact = pg_current_xact_id())`. Así cumplen la regla de catálogo de `apps/api/test/support/db.ts` y ninguna sesión ve las claves de otra.
   - Las tablas de la cola reciben `SELECT, INSERT, DELETE` para los roles que hoy insertan en las tablas base, y nada para `PUBLIC`.
6. **Migración**: una sola migración, con timestamp posterior a la última de `main` al implementarla. Dentro de su transacción crea las tablas, funciones y disparadores nuevos y elimina los cuatro disparadores por fila (`posting_balanced_trg`, `journal_entry_postings_trg`, `transaction_splits_sum_tx` y `transaction_splits_sum_split`). Las funciones viejas se conservan sin uso, para que `migrate:down` restaure los disparadores por fila tal como estaban.

   Es expand en el sentido del proyecto: no toca datos, columnas ni contratos, y el código N−1 funciona igual con los dos mecanismos. La eliminación de los disparadores reemplaza un mecanismo interno, no contrae el esquema que usa la aplicación.

Por qué esta opción:

- Es la única que mantiene la evaluación **al confirmar** con estados intermedios y baja el número de funciones ejecutadas de unas 25 000 por import a unas 50 recolectoras y 25 validadoras por cada uno de los dos contextos.
- Funciona igual con escrituras por fila (registro manual) y por conjunto (import, portabilidad).

## Análisis de opciones

### 1. Recolector por sentencia y validador diferido por transacción

- **Pros:**
  - Misma semántica: evaluación al confirmar, estados intermedios admitidos, `SET CONSTRAINTS ALL IMMEDIATE` y savepoints respetados (verificado en el prototipo).
  - Una consulta por conjunto en vez de una función por fila.
  - No cambia el código de aplicación ni los contratos.
  - Las colas `UNLOGGED` no generan WAL.
  - Reversible por `migrate:down`.
- **Contras:**
  - Más objetos de base de datos: 4 tablas y 6 recolectores en vez de 4 disparadores.
  - La lógica de la suma de los splits vive en una consulta por conjunto que debe mantenerse equivalente a la función actual.
  - Escribe y borra filas en la cola en cada transacción que toca esas tablas, con filas muertas que limpia la limpieza automática.
  - Una `UPDATE` de `txn.transaction` en otras columnas ejecuta el recolector, aunque no encole nada.
- **Costo:** una migración y su suite de equivalencia. Sin infraestructura nueva.
- **Complejidad operativa:** baja. Las colas vacías son el estado normal. Una fila en la cola fuera de una transacción abierta sería un defecto y la puede vigilar `VerifyLedgerIntegrity`.

### 2. Disparadores por sentencia que validan al final de la sentencia

- **Pros:** el mecanismo más simple con tablas de transición; una consulta por sentencia.
- **Contras:** **cambia la semántica**.
  - El asiento se inserta antes que sus postings (FK), así que «al menos dos postings» fallaría al terminar la sentencia del asiento.
  - El registro posting a posting de TC-LEDGER-BALANCE-002 y las revisiones en varias sentencias (monto, reemplazo de splits, inserción) también fallarían en el estado intermedio.
  - Exigiría reescribir todas las escrituras en una sola sentencia (CTE con varios `INSERT`; verificado: los disparadores por sentencia de un CTE corren al final de la sentencia completa), lo que cambia repositorios de LEDGER y TRANSACTIONS y el importador de portabilidad.
- **Costo:** alto, en código de aplicación de dos contextos.
- **Complejidad operativa:** media: cualquier escritura nueva en varias sentencias se rompe.

### 3. Disparadores de restricción por fila, más baratos

- **Pros:** sin objetos nuevos y la misma semántica por construcción.
- **Contras:**
  - El número de llamadas no baja: un evento por fila. Sin estado por transacción no se puede deduplicar, y `WHEN` no reduce nada en el import (todas son gastos o ingresos).
  - En el prototipo local el costo por llamada ya es de 6 a 8 µs, así que no queda mucho que recortar dentro de la función.
- **Costo:** bajo.
- **Complejidad operativa:** nula. La ganancia esperada también es casi nula.

### 4. Validación solo en la aplicación

- **Pros:** quita todo el costo de la base de datos.
- **Contras:**
  - Elimina la segunda defensa de INV-004, INV-005 e INV-021 (ARCHITECTURE §4.1). Rompe TC-LEDGER-BALANCE-002 y TC-LEDGER-STRUCTURE-002 y la condición de D404, que pide que un asiento descuadrado inyectado siga revirtiendo el lote.
  - Una escritura directa con el rol de aplicación quedaría sin barrera.
- **Costo:** bajo en código, alto en riesgo.
- **Complejidad operativa:** alta: la integridad contable depende de que ningún camino se saltee el dominio.

### 5. Mantener lo actual

- **Pros:** sin riesgo de cambio.
- **Contras:** la fila del host sigue en rojo con alta probabilidad. D403 queda sin palanca, y la meta de 20 s vuelve a D446.
- **Costo:** nulo.
- **Complejidad operativa:** nula.

## Consecuencias

**Positivas:**

- La validación del import pasa de una función por fila a una consulta por conjunto por lote, con la misma barrera al confirmar.
- El importador de portabilidad, que inserta un workspace entero en una transacción y valida con `SET CONSTRAINTS ALL IMMEDIATE`, también se beneficia.
- Sin cambios de contrato, de código de aplicación ni de configuración.

**Negativas:**

- Cuatro tablas internas nuevas, con filas solo dentro de transacciones abiertas, y seis recolectores, que hay que documentar en docs/09 y docs/08 al aceptar el ADR.
- La equivalencia de `txn.assert_splits_sum` con su versión por conjunto queda como responsabilidad de los tests: cualquier tipo nuevo de transacción con splits debe cambiar las dos o solo la nueva.
- Las filas de la cola se escriben y se borran en cada transacción que toca esas tablas, lo que genera filas muertas que limpia la limpieza automática.

**Riesgos:**

- **Ganancia incierta en CI.** En el prototipo local con PostgreSQL 18.6 en reposo, las tres funciones cuestan entre 75 y 95 ms por import en el ledger y unos 78 ms en los splits, frente a 3,6 a 7,2 s medidos en el runner. La diferencia, de 40 a 50 veces, no la explica la CPU: la calibración del runner es de 47 a 80 ms y la del equipo local, de 54 ms. Lo más probable es que el tiempo propio de reloj del runner incluya la espera de CPU por la contención de H3, como ya advierte docs/67 §5. Con el recolector, el trabajo de validación bajó de 2,4 a 2,6 veces con 100 000 asientos previos, pero no bajó con tablas vacías. **Por eso la Validación mide antes de fusionar.** Si la persistencia no baja, el ADR se rechaza y la meta vuelve a D446.
- **Equivalencia de la suma de los splits:** mismo SQLSTATE, misma restricción y misma lógica por tipo (`INCOME`, `EXPENSE`, `REFUND`, `LOAN_PAYMENT`, `LOAN_DISBURSEMENT`). La cubren TC-TRANSACTIONS-SPLIT-007, las pruebas de préstamos de `pg-loans.int.test.ts` y TC-TRANSACTIONS-BULKIMPORT-005.
- **Orden de los errores** cuando una transacción viola varias comprobaciones: el validador reproduce el orden actual (`PF005` antes que `PF001`; TRANSACTIONS antes que LEDGER si la transacción se insertó primero). Con varias claves que fallan puede citar otra clave que hoy: el SQLSTATE y el código de dominio no cambian.
- **Deploy:** `DROP TRIGGER` toma un bloqueo exclusivo breve sobre `ledger.posting`, `ledger.journal_entry`, `txn.transaction` y `txn.transaction_split`. La migración corre con `lock_timeout` y en la ventana de deploy de N1.
- **Escrituras de `pf_migrator`** (migraciones o seeds que inserten en esas tablas) pasan por los recolectores. La política de la cola es para todos los roles, así que funcionan igual.

## Validación

El ADR pasa a **Aceptado** cuando se cumplen las tres condiciones, en este orden:

1. **Tests primero, en verde con los disparadores por fila y con los nuevos.**
   - Escenarios nuevos: TC-LEDGER-BALANCE-004 (lote por conjunto con un asiento descuadrado inyectado: se revierte todo), TC-LEDGER-STRUCTURE-003 (asiento sin postings en un lote y con `SET CONSTRAINTS ALL IMMEDIATE`) y TC-TRANSACTIONS-SPLIT-007 (barrera de splits al confirmar, revisión en varias sentencias y lote con un split inyectado que no suma).
   - Existentes: TC-LEDGER-BALANCE-002, TC-LEDGER-STRUCTURE-002, las pruebas de `pg-loans.int.test.ts`, TC-IMPORTS-CSV-023/024 (fallo parcial y reintento), la verificación del importador de portabilidad y la regla de catálogo de RLS.
   - La equivalencia del change 52 (TC-TRANSACTIONS-BULKIMPORT-005) queda en verde.
2. **Medición en la rama de experimentos** (`claude/import-persist-perf-experiments`, no se fusiona), con la variante de la migración nueva frente a `host`, en pares en el mismo runner, ≥ 3 repeticiones y `track_functions = 'pl'`:
   - El tiempo propio de las funciones de validación baja al menos un 50 % frente a la suma de las tres funciones actuales.
   - La persistencia mediana de la fila del host baja al menos un 10 %.
   - El registro manual (NFR-PERF-003) no empeora más allá de su ruido.

   Si no se cumple, el ADR pasa a **Rechazado** con la medición en Notas, no se fusiona la migración y la meta de 20 s vuelve al owner (D446).
3. **Tras fusionar:** los nightlies programados de la tarea 8.1 publican la persistencia del host con la migración aplicada. El criterio de salida sigue siendo D403.

## Notas

- **2026-11-20, restricciones de PostgreSQL 18 verificadas en un contenedor 18.6** (misma imagen que `deploy/compose/compose.yaml`; documentación de [CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html)):
  - `CREATE CONSTRAINT TRIGGER … REFERENCING NEW TABLE …` y `CREATE CONSTRAINT TRIGGER … FOR EACH STATEMENT` dan `syntax error`: la gramática solo admite `AFTER … FOR EACH ROW` para los disparadores de restricción.
  - `AFTER INSERT OR UPDATE … REFERENCING NEW TABLE` da `transition tables cannot be specified for triggers with more than one event`.
  - `AFTER UPDATE OF amount … REFERENCING NEW TABLE` da `transition tables cannot be specified for triggers with column lists`.
  - En un CTE con dos `INSERT`, el disparador por sentencia de la primera tabla corre al final de la sentencia completa.
  - El `WHEN` de un disparador de restricción se evalúa al encolar el evento.
  - `pg_current_xact_id()` devuelve el identificador de la transacción principal también dentro de un savepoint.
- **2026-11-20, prototipo local del mecanismo**, con un esquema simplificado con RLS forzada y rol sin privilegios. Son 5 000 asientos de 2 postings y 5 000 transacciones con un split, en 25 transacciones de 200 filas con `INSERT … SELECT` por conjunto, y 3 repeticiones.
  - Por fila, el ledger cuesta ≈ 95 ms por import con 100 000 asientos previos (75 ms con tablas vacías) y los splits ≈ 78 ms.
  - Con el recolector y el validador, el ledger cuesta ≈ 37 ms (74 ms con tablas vacías) y los splits ≈ 33 ms.
  - La semántica se verificó en el mismo prototipo:
    - un asiento descuadrado en un lote de 200 revierte el lote;
    - un asiento sin postings da `PF005`;
    - los postings en sentencias separadas confirman;
    - un savepoint revertido con el centinela adentro y un descuadre posterior revierte la transacción;
    - `SET CONSTRAINTS ALL IMMEDIATE` falla en ese momento;
    - una revisión de splits en tres sentencias confirma y un cambio de monto sin splits nuevos falla con `transaction_splits_sum_ck`;
    - las colas quedan vacías.

  El prototipo no reemplaza la medición de la Validación: no reproduce la contención del runner.
