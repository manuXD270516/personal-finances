# ADR-0028: Bloqueo del ledger por el rango del periodo financiero

- Estado: Aceptado (2026-10-08, decisión del owner D107; propuesto el 2026-10-05)
- Fecha: 2026-10-05
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/31-phase-1-consolidation-decisions.md (D10, D19, D23, D49); docs/33-phase-2-consolidation-decisions.md (D107); docs/09-ledger-design.md §10 e INV-015; docs/08-data-model.md §5.3 (`ledger.period_lock`) y §5.6; docs/14-reporting.md §2; ADR-0004, ADR-0023; OpenSpec changes `add-financial-periods` (`planning/financial-periods`) y `add-month-closing` (`planning/month-closing`, modifica `ledger/journal-posting`)

## Contexto y problema

En Phase 1 el ledger rechaza asientos en periodos bloqueados (`PERIOD_CLOSED`, SQLSTATE `PF004`) y el bloqueo es **mensual calendario** por decisión D10: `ledger.period_lock` tiene una fila por `(workspace_id, year_month)` y el trigger compara `to_char(entry_date, 'YYYY-MM')`.

Desde Phase 1 el workspace también tiene un **día de inicio del mes financiero** configurable de 1 a 28 (FR-IDENTITY-005, D23, `iam.workspace.fiscal_month_start_day`), y docs/14 §2 prevé periodos financieros que no coinciden con el mes calendario (p. ej. del 25 al 24, por fecha de cobro del salario). En Phase 2, `planning/financial-periods` convierte ese día en rangos de fechas y `planning/month-closing` cierra esos periodos. Con día de inicio 25, el periodo "2026-10" va del 2026-10-25 al 2026-11-24: un bloqueo por mes calendario no puede representarlo (bloquearía 2026-10-01..24, que pertenece a otro periodo aún abierto, y dejaría abierto 2026-11-01..24, que ya está cerrado). INV-015 ("un periodo cerrado no cambia silenciosamente") quedaría violada.

## Drivers de decisión

- INV-015 debe valer para el periodo que el usuario cierra, sea cual sea su día de inicio.
- No romper Phase 1: TC-LEDGER-PERIOD-001/002, TC-CLASSIFICATION-RECATEGORIZE-002 y `LedgerPeriodLockPort` en uso.
- Doble barrera (dominio + BD) y cierre de la carrera "cerrar mes ↔ postear" (docs/09 §10).
- Migración solo *expand*, sin datos productivos que transformar.

## Opciones consideradas

1. **Bloqueo por rango del periodo financiero**: `ledger.period_lock` conserva una fila por periodo (clave `(workspace_id, year_month)` con `year_month` = etiqueta del periodo) y agrega `period_start`/`period_end`; el trigger comprueba `entry_date` dentro del rango.
2. **Mantener el bloqueo mensual calendario y restringir el producto**: en Phase 2 solo se puede cerrar con día de inicio 1; con otro día, el cierre se rechaza.
3. **Bloquear cada mes calendario que toque el periodo** (para "2026-10" con día 25: octubre y noviembre completos).

## Decisión

Opción 1 (aceptada por el owner el 2026-10-08, docs/33 D107). `ledger.period_lock` pasa a representar el **rango inclusivo de un periodo financiero cerrado**: columnas nuevas `period_start date NOT NULL` y `period_end date NOT NULL`, exclusión gist `(workspace_id WITH =, daterange(period_start, period_end, '[]') WITH &&)`, y la clave primaria `(workspace_id, year_month)` se mantiene con `year_month` = etiqueta del periodo. El primer periodo cerrado de un workspace se bloquea con `period_start = '-infinity'` (todo lo anterior al primer periodo queda protegido: el cierre es en orden). `ledger.assert_period_open()` y `PeriodLockRepository.isLocked(workspaceId, date)` pasan a comparar por rango. `LedgerPeriodLockPort.lockPeriod` recibe `periodStart`/`periodEnd` (opcionales: si faltan, el rango es el mes calendario de `yearMonth`, que es exactamente el comportamiento de Phase 1).

Con día de inicio 1 el comportamiento observable es **idéntico** al de D10. Esta decisión **enmienda D10** (el bloqueo sigue siendo "uno por periodo mensual", pero el periodo es el financiero, no el calendario).

## Análisis de opciones

**Opción 1 — rango del periodo financiero**
- Pros: INV-015 exacta para cualquier día de inicio; una fila por cierre (igual que hoy); compatible con Phase 1 (día 1 = mes calendario); el trigger sigue siendo un `EXISTS` indexable (gist).
- Contras: la comprobación deja de ser una igualdad de texto (`year_month`) y pasa a un rango (costo despreciable con un índice gist y pocas filas por workspace); cambia la firma interna de `isLocked`.
- Costo: una migración *expand* + *contract* corta (las columnas nuevas se rellenan desde `year_month` para filas existentes de tests) y ajustes en el repositorio y el trigger.
- Complejidad operativa: baja.

**Opción 2 — solo día de inicio 1 en Phase 2**
- Pros: cero cambios en el ledger.
- Contras: deja sin efecto un setting que el owner ya puede cambiar desde Phase 1; docs/14 lo contempla; habría que rechazar cierres o prohibir el setting (cambio de comportamiento existente).
- Costo: bajo ahora, deuda alta después.
- Complejidad operativa: baja, pero confusa para el usuario.

**Opción 3 — bloquear meses calendario completos**
- Pros: sin cambios de esquema.
- Contras: bloquea días de periodos aún abiertos (rechazos `PERIOD_CLOSED` falsos) — viola la expectativa del usuario y bloquea su operación diaria.
- Costo: bajo; costo de producto inaceptable.
- Complejidad operativa: baja.

## Consecuencias

- Positivas: INV-015 correcta para periodos financieros; contratos públicos compatibles; el rechazo por recategorización en periodo cerrado (D49) y cualquier `assertPeriodOpen(date)` siguen funcionando sin cambios para sus llamadores.
- Negativas: docs/08 §5.3 (punto 6), docs/09 §10 y D10 deben actualizarse; el bloqueo deja de ser legible como "mes calendario" en consultas ad hoc.
- Riesgos: rango mal calculado (mitigado con `PeriodCalendar` puro + PBT de contigüidad y TC-LEDGER-PERIOD-003); solapamiento de bloqueos (mitigado por la exclusión gist).

## Validación

- TC-LEDGER-PERIOD-001/002 siguen en verde sin cambios (día de inicio 1).
- TC-LEDGER-PERIOD-003 (nuevo): con día de inicio 25, el cierre de "2026-10" rechaza 2026-10-25 y 2026-11-24, y acepta 2026-10-24 y 2026-11-25; el primer periodo cerrado rechaza fechas anteriores a su inicio.
- `EXPLAIN ANALYZE` del trigger con el dataset `large`: overhead por asiento < 0.1 ms.

## Notas

- 2026-10-05: propuesto por el bloque pf-p2a de specs de Phase 2 (`add-month-closing`). Requiere confirmación del owner (pregunta P-A7 de `add-month-closing`). Si se rechaza, se aplica la Opción 2 y `add-month-closing` agrega el rechazo del cierre con día de inicio ≠ 1.
- El número 0028 es el siguiente libre a la fecha; si otro change de Phase 2 propone un ADR en paralelo, el lead renumera al consolidar.
- 2026-10-08: **aceptado** por el owner (docs/33 D107, pregunta 49 de docs/32). Se descarta la Opción 2; `add-month-closing` implementa la Opción 1.
