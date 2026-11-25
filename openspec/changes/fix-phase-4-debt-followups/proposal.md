# Propuesta: fix-phase-4-debt-followups

## Why

D481 (pregunta 17 de docs/76, recomendación aplicada por omisión) pide un change de seguimiento con la deuda conocida de Phase 4 y de tarjetas que sigue abierta, con contratos aditivos y sin migraciones de datos, antes de que el owner use tarjetas y préstamos reales en N1. La verificación en `origin/main` del 2026-11-25 (`fix-debt-cards-loans-gaps`, #275 y #279, y la revisión de #280) dejó cerrados `overdueStatements[]`, la métrica `debt_card_cycle_mismatch_total`, la lectura en lote de la lista de préstamos, `nextDueDate` con vencimientos pasados, el ciclo con saldo inicial y el benchmark del simulador. Quedan cuatro puntos, tres de ellos con respuesta del owner del 2026-11-25:

- Las transacciones de préstamo (`LOAN_DISBURSEMENT`, `LOAN_PAYMENT`) no se pueden anotar desde la pantalla, aunque la API ya acepta la descripción y las notas; el cargo de tarjeta abre el formulario completo y recién al guardar se entera de que el monto no se edita.
- Las cuotas de tarjeta no se rotulan «cuotas» en los próximos pagos ni en Q8: el requirement existe (Could), pero el contrato de próximos pagos no dice de dónde sale el monto estimado. El owner aceptó la opción (a): el origen del esperado (`basis`) viaja con la ocurrencia.
- Q5 sin un periodo financiero que cubra hoy usa el mes calendario y no consulta el plan (`period.id = null`); el owner confirmó ese comportamiento y falta el scenario que lo fije.
- Al retomar una importación que espera el mapeo, `GET /imports/{id}` no devuelve las filas de muestra y la UI lo avisa con `mapping-no-sample`; el owner aceptó la recomendación de un arreglo chico. No es deuda de Phase 4 (es del pipeline de importación), pero es del mismo tipo: aditivo y sin migración de datos (decisión 5 del design).

## What Changes

- **Edición descriptiva de transacciones administradas desde la pantalla** (`transactions/transaction-recording`): el detalle de una transacción de préstamo ofrece editar la descripción y las notas, y el de un cargo de tarjeta muestra los campos financieros como solo lectura. La API no cambia.
- **Rótulo «cuotas» en los próximos pagos y en Q8** (`reporting/cash-flow-calendar`, MODIFIED): la ocurrencia de pago de tarjeta guarda el origen de su monto esperado (estado emitido, ciclo abierto o cuotas), DEBT lo informa al fijar el esperado, y la lista de próximos pagos lo expone. El rótulo deja de depender del nombre o de la fecha.
- **Q5 sin periodo financiero** (`reporting/dashboard`): requirement nuevo que fija el comportamiento actual (mes calendario, sin identificador de periodo, segunda vista sin plan). Sin cambio de código salvo el test que lo cita.
- **Filas de muestra al retomar una importación** (`imports/import-pipeline`): `GET /imports/{id}` devuelve hasta 20 filas de muestra mientras la importación espera el mapeo, leídas del staging que ya existe; la UI deja de mostrar el aviso `mapping-no-sample` en ese caso.
- **Fuera de alcance:**
  - El job horario de metas (`GOALS_DAILY_CRON`) se queda: es idempotente (D481).
  - La «decisión Phase 7» de docs/38 §4 (horizonte hasta el próximo ingreso, esenciales y alerta de déficit) ya la cerraron `add-cash-flow-forecast` y D218.
  - Editar un préstamo en borrador desde la pantalla y la adopción de una tabla del banco con fechas distintas: no están en la pregunta 17 (pregunta abierta 2 del design).
  - Tags en las transacciones de préstamo: no tienen splits y el tag vive en el split (pregunta abierta 1).
  - El supuesto de «N tarjetas sin pago programado» de Q5 (pregunta abierta 3).
  - Lo ya resuelto por `fix-debt-cards-loans-gaps` y `fix-phase-4-gaps`.

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `transactions/transaction-recording`: 1 ADDED. Edición descriptiva de las transacciones administradas por una deuda desde la pantalla.
- `reporting/cash-flow-calendar`: 1 MODIFIED. Cuotas de tarjeta futuras en los próximos pagos: el rótulo «cuotas» también en Q8, el origen del esperado en la respuesta, y sin el rótulo en el ciclo abierto ni en el estado emitido.
- `reporting/dashboard`: 1 ADDED. Disponible para gastar sin un periodo financiero que cubra hoy.
- `imports/import-pipeline`: 1 ADDED. Filas de muestra al retomar una importación que espera el mapeo.

## Impact

**Specs impactadas:** `transactions/transaction-recording` (1 ADDED), `reporting/cash-flow-calendar` (1 MODIFIED), `reporting/dashboard` (1 ADDED) e `imports/import-pipeline` (1 ADDED). Sin deltas en `debt/loans` ni `debt/credit-cards`: la spec `debt/loans` todavía no existe en `openspec/specs/` (la crea el archivo de `add-loans`), y el cambio de DEBT es interno (decisión 2 del design).

**Componentes/contextos impactados:**
- `apps/web`: detalle de transacciones (edición descriptiva de las administradas), próximos pagos y tarjeta Q8 (rótulo «cuotas»), paso de mapeo del import (muestra al retomar).
- COMMITMENTS: la ocurrencia guarda el origen del esperado; `RecurringDefinitionPort.setExpected` y `UpcomingPaymentDto` lo aceptan y lo exponen (aditivo).
- DEBT: `card-engine` informa el origen al fijar el esperado del plan de pago (`payment-plan-expectation`).
- REPORTING: `getUpcomingPayments` copia el origen al ítem.
- IMPORTS: `getImport` lee las primeras 20 filas del staging en `AWAITING_MAPPING`.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo, `oasdiff` limpio):
- `UpcomingPaymentItem.expectedBasis` opcional (`x-extensible-enum`: `STATEMENT`, `OPEN_CYCLE`, `INSTALLMENTS`).
- `getImport` responde un esquema nuevo `ImportJobDetail` (`ImportJob` más `sampleRows` opcional).
- Sin códigos de error nuevos.

**Tablas impactadas:** `commitments.recurring_occurrence` (columna nueva `expected_basis text NULL`).

**Eventos impactados:** ninguno. El origen del esperado no viaja en los eventos de ocurrencia (decisión 2 del design).

**Migraciones requeridas:** una migración expand que agrega `expected_basis` nullable con su `CHECK`. Sin migración de datos (D481): las ocurrencias existentes quedan en `NULL` y el siguiente paso diario de tarjetas (`debt.card-daily`) las completa al recalcular el esperado.

**Test cases:**
- AÑADIDOS: TC-TRANSACTIONS-MANAGEDEDIT-001..004 (4), TC-REPORTING-UPCOMING-023..025 (3), TC-REPORTING-SPENDABLE-016 (1) y TC-IMPORTS-CSV-031..033 (3).
- MODIFICADOS: TC-DEBT-CARD-033 (agrega la indicación «cuotas» y el origen del esperado a lo esperado; hoy el test no lo comprueba).
- DEPRECADOS: ninguno.

**Impacto de regresión:**
- Próximos pagos, comprometido, calendario de flujo de caja y Q5 no cambian de cifras: el origen es un dato más (TC-REPORTING-UPCOMING-*, TC-DEBT-CARD-031..033 y TC-REPORTING-SPENDABLE-* en verde).
- La edición financiera de las administradas sigue rechazada por la API (TC-TRANSACTIONS-CARDCHARGE-002 y los de `add-loans` en verde).
- `getImport` en los demás estados responde igual que hoy.

**Riesgos introducidos:** ninguno registrado. Ocurrencias de tarjeta con origen `NULL` hasta el paso diario siguiente: sin rótulo durante ese lapso (riesgo aceptado, decisión 2).

**Invariantes afectadas:** ninguna. No hay escrituras en el ledger: la edición descriptiva no crea asientos (INV-021 sigue igual) y el origen del esperado no cambia montos.
