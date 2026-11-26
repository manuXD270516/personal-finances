# Diseño

## Contexto

Change 75 de Phase 9 (docs/03 §7, D472). D481 (pregunta 17 de [docs/76](../../../docs/76-phase-9-and-card-interest-questions.md), recomendación aplicada por omisión en [docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)) lo define como un change de seguimiento con contratos aditivos y sin migraciones de datos; el job horario de metas se queda.

Verificación en `origin/main` (2026-11-25) de la lista de docs/38 §4 y de la pregunta 17:

| Punto | Estado en `main` | En este change |
|---|---|---|
| `overdueStatements[]` incompleto en el listado de tarjetas | Resuelto por `fix-debt-cards-loans-gaps` (#275, archivado en #279) | No |
| Métrica `debt_card_cycle_mismatch_total` | Resuelta por `fix-debt-cards-loans-gaps` | No |
| Lista de préstamos con 2 consultas por préstamo | Resuelta por `fix-debt-cards-loans-gaps` | No |
| `nextDueDate` con un vencimiento pasado | Resuelto por `fix-phase-4-gaps` (`NextDueResolver`, TC-DEBT-CARD-038/039; verificado en #280) | No |
| Ciclo con saldo inicial `consistent = false` | Resuelto por `fix-phase-4-gaps` (TC-DEBT-CARD-040) | No |
| Benchmark del simulador de prepago | Existe (`loan-simulator.perf.ts`, TC-DEBT-AMORT-045) | No |
| Notas y descripción de `LOAN_*` no editables desde la UI | Abierto: la API las acepta (`assertManagedEditAllowed`), pero `TransactionDetail` solo ofrece «Editar» a `EXPENSE`, `INCOME`, `REFUND` y `ADJUSTMENT` | Sí (decisión 1) |
| Rótulo «cuotas» en Q8 | Abierto: el requirement «Cuotas de tarjeta futuras en los próximos pagos» existe y TC-DEBT-CARD-033 figura `automated`, pero su test solo comprueba monto y `amountType: ESTIMATED`; ni la ocurrencia ni `UpcomingPaymentItem` saben de dónde sale el estimado | Sí (decisión 2; opción (a) `expected.basis`, aceptada por el owner el 2026-11-25) |
| Q5 sin periodo financiero que cubra hoy | Implementado (`spendable.queries.ts`: mes calendario, `period.id = null`, `budgetView.status = NO_PLAN`; el test cita TC-REPORTING-SPENDABLE-011, que es de otro scenario). La spec no lo define | Sí (decisión 3; el owner confirmó el diseño actual el 2026-11-25) |
| «N tarjetas sin pago programado» de Q5 | Implementado como supuesto (D213); la spec no lo define | Sí (decisión 6; criterio confirmado por D491) |
| Filas de muestra al retomar una importación | Abierto: `getImport` devuelve `ImportJob` sin `sampleRows`; la UI avisa con `mapping-no-sample` | Sí (decisión 4; el owner aceptó el arreglo chico el 2026-11-25) |
| Job horario de metas (`GOALS_DAILY_CRON`) | Se queda (D481, idempotente) | No |
| «Decisión Phase 7» | Cerrada por `add-cash-flow-forecast` (horizonte hasta el próximo ingreso, esenciales y alerta de déficit; D218) | No |
| Préstamo en borrador no editable desde la pantalla; tabla del banco con fechas distintas | Abiertos, fuera de la pregunta 17 | No: quedan en docs/38 (D490) |

## Objetivos / No objetivos

**Objetivos**
- Cerrar los cinco puntos abiertos de la tabla con contratos aditivos, sin migraciones de datos y sin consumidores ni conexiones nuevas (D249).
- Que cada TC del change compruebe de verdad lo que dice su scenario (el caso de TC-DEBT-CARD-033).

**No objetivos**
- Cambiar cifras de próximos pagos, comprometido, calendario o Q5.
- Editar desde la pantalla los campos financieros de una transacción administrada (siguen rechazados con `TRANSACTION_MANAGED_EXTERNALLY`).
- Devolver la muestra en estados posteriores al mapeo o para formatos sin mapeo.

## Decisiones

1. **Edición descriptiva de las transacciones administradas (UI).**
   - `TransactionDetail` ofrece «Editar descripción y notas» a las transacciones `LOAN_DISBURSEMENT` y `LOAN_PAYMENT` no anuladas, a los roles con edición. Abre un formulario reducido (descripción y notas) que manda `PATCH /transactions/{id}` con `If-Match` y solo esos campos; el endpoint ya los acepta sin tocar el ledger.
   - Un cargo de tarjeta (`EXPENSE` con `debtRole = CARD_CHARGE`) abre el formulario de edición con monto, cuenta, fecha, moneda y la categoría de sus porciones como solo lectura, con el aviso «Lo administra la tarjeta» y el enlace a ella. Descripción, notas, tags y contraparte quedan editables, como dice su requirement.
   - Los tags de un préstamo no se ofrecen: las transacciones `LOAN_*` no tienen splits y el tag vive en el split (D489; el delta de `add-loans` ya dice «descripción y notas»).
   - Sin cambios de API ni de dominio. El rechazo del servidor sigue siendo la defensa (TC-TRANSACTIONS-CARDCHARGE-002).

2. **Origen del esperado de una ocurrencia (opción (a) `expected.basis`).**
   - COMMITMENTS: `commitments.recurring_occurrence.expected_basis text NULL CHECK (expected_basis IN ('STATEMENT','OPEN_CYCLE','INSTALLMENTS'))`. `ManagedExpectationDto` suma `basis?` y `setExpected` lo guarda junto con el monto. Un `setExpected` sin `basis` lo deja en `NULL`, y `unsettle`, `replaceSchedule` y la edición del usuario también, para que nunca quede un origen que ya no corresponde.
   - El origen solo lo fija el administrador: el usuario no lo ve ni lo edita en la ocurrencia.
   - `UpcomingPaymentDto` y `ManagedOccurrenceDto` suman `expectedBasis: 'STATEMENT' | 'OPEN_CYCLE' | 'INSTALLMENTS' | null`.
   - DEBT: `payment-plan-expectation` devuelve el origen con cada expectativa:
     - `expectationForIssued`: `STATEMENT`.
     - `expectationForOpen`: `OPEN_CYCLE`.
     - `expectationForFuture`: `INSTALLMENTS`.

     `card-engine` lo pasa a `setExpected`. `sameExpectation` compara también el origen, así que el primer paso diario después del despliegue completa las ocurrencias existentes sin una migración de datos.
   - REPORTING: `getUpcomingPayments` copia el origen a `UpcomingPaymentItem.expectedBasis`. La web muestra «cuotas» cuando vale `INSTALLMENTS`, en la lista de próximos pagos y en la tarjeta Q8, con i18n es/en/pt («cuotas», «installments», «parcelas»).
   - *Alternativas descartadas:* (b) REPORTING lee `@pf/debt/contracts` para saber si hay cuotas en el ciclo (crea una dependencia nueva de REPORTING hacia DEBT solo para un rótulo); (c) inferirlo del nombre o de la fecha de la ocurrencia (frágil).
   - Los eventos de ocurrencia no cambian: el origen es un dato de presentación y ningún consumidor lo necesita.
   - El export lleva la columna como propiedad opcional (`contracts/export/v1/recurring-occurrences.schema.json`); un export anterior se importa con `NULL`.

3. **Q5 sin periodo financiero.** Se agrega el requirement con el comportamiento actual, confirmado por el owner:
   - El horizonte es el mes calendario que contiene hoy en la zona del workspace.
   - El periodo de la respuesta no tiene identificador (`period.id = null`) y su etiqueta es la del mes.
   - La segunda vista indica que no hay presupuesto y ofrece crearlo, como en «Periodo sin plan».

   El test unitario existente (`spendable.queries.test.ts`) pasa a citar TC-REPORTING-SPENDABLE-016 en lugar de TC-REPORTING-SPENDABLE-011, y se agrega un caso de API. Sin cambio de código productivo.

4. **Filas de muestra al retomar.**
   - `getImport` responde `ImportJobDetail`: `ImportJob` más `sampleRows` opcional. El campo solo está en `AWAITING_MAPPING` y lleva hasta 20 registros posteriores al primero, leídos de `imports.staged_transaction.raw` por `row_number`, la misma fuente que el mapeo.
   - En los demás estados el campo no está y la respuesta es la de hoy.
   - El `ETag` se calcula como hoy: la muestra no cambia mientras el estado es `AWAITING_MAPPING`.
   - `suggestedMapping` (D492, Could): en `AWAITING_MAPPING`, `ImportJobDetail` lleva también el mapeo sugerido opcional, el mismo de `ImportCreated.suggestedMapping` (el de la última importación de la cuenta, leído de `jobs.lastMapping`), con la misma condición de estado. Si la cuenta no tiene importaciones anteriores, el campo no está. La UI lo usa para precargar el formulario al retomar, como al crear.
   - La UI (`MappingStep`) usa la muestra de `getImport` al retomar y conserva el aviso `mapping-no-sample` solo si la respuesta no la trae.
   - Texto no confiable: se escapa siempre, como al crear.

5. **Por qué las filas de muestra van en este change.** El arreglo de la muestra no es deuda de Phase 4. Va aquí porque tiene la misma forma que el resto (aditivo, sin migración de datos, chico) y porque abrir un change propio para un campo opcional duplicaría el proceso. El owner lo confirmó (D493).

6. **«N tarjetas sin pago programado» en Q5 (D491).** Se agrega el requirement con el criterio vigente de D213, sin cambio de código productivo: cuenta las tarjetas con saldo adeudado sin ninguna transferencia recurrente no resuelta ni transacción pendiente hacia ellas con fecha hasta el fin del horizonte, sin comparar con el pago mínimo. *Alternativa descartada:* contar también las que tienen programado menos que el mínimo; exige que REPORTING lea el mínimo del estado de cuenta de DEBT, una dependencia nueva. Los tests existentes de `cardsWithoutPaymentCount` pasan a citar TC-REPORTING-SPENDABLE-017 y -018 (tarea 3.6).

## Contratos

**`contracts/openapi/finance-api.v1.yaml` (aditivo; `oasdiff` limpio, Spectral y Redocly sin errores):**
- `UpcomingPaymentItem.expectedBasis` (opcional): `type: string`, `x-extensible-enum: [STATEMENT, OPEN_CYCLE, INSTALLMENTS]`. Descripción: «Origen del monto esperado de un pago de tarjeta: estado de cuenta emitido, ciclo abierto o cuotas programadas de un ciclo posterior. Ausente en los demás pagos».
- `ImportJobDetail` (nuevo): `allOf: [ImportJob, {type: object, properties: {sampleRows: {type: array, maxItems: 20, items: {type: array, items: {type: string}}}, suggestedMapping: {$ref: <el esquema de ImportCreated.suggestedMapping>}}}]`, con las descripciones de `ImportCreated.sampleRows` y `ImportCreated.suggestedMapping`; las dos propiedades son opcionales y solo están en `AWAITING_MAPPING` (`suggestedMapping`, además, solo si la cuenta tiene una importación anterior; D492). `getImport` responde `ImportJobDetail` en el 200. El cambio de `$ref` es compatible: el esquema nuevo es `ImportJob` más una propiedad opcional (se verifica con `pnpm contract:breaking` en la tarea 5.1).
- Sin códigos de error nuevos.

**Contratos internos (TypeScript, aditivos):**
- `@pf/commitments/contracts`:
  - `ManagedExpectationDto.basis?: 'STATEMENT' | 'OPEN_CYCLE' | 'INSTALLMENTS'`.
  - `UpcomingPaymentDto.expectedBasis` y `ManagedOccurrenceDto.expectedBasis` (`… | null`).
- `@pf/debt`: interno (`payment-plan-expectation`, `card-engine`).
- `@pf/imports`: `JobView` de `getImport` suma `sampleRows?` y `suggestedMapping?` en `AWAITING_MAPPING`.

**Eventos:** ninguno.

**Base de datos (migración expand, timestamp posterior a la última de `main`):**
- `commitments.recurring_occurrence`: `ADD COLUMN expected_basis text NULL` y `CHECK (expected_basis IS NULL OR expected_basis IN ('STATEMENT','OPEN_CYCLE','INSTALLMENTS'))` agregado `NOT VALID` y validado en la misma migración.
- Sin cambios de RLS: la tabla ya tiene RLS forzada y registro en `platform.workspace_scoped_table`.
- Sin backfill (D481).

**Configuración:** ninguna variable nueva.

## Riesgos / Trade-offs

- [Ocurrencias de tarjeta con origen `NULL` hasta el próximo `debt.card-daily`] → no hay rótulo durante ese lapso (como hoy). El paso diario las completa porque `sameExpectation` compara el origen.
- [Un administrador futuro que no informe el origen] → `NULL` es el valor neutro y la UI no rotula.
- [Formulario reducido para préstamos y formulario con campos de solo lectura para cargos] → dos variantes del mismo componente. Se cubren con TC-TRANSACTIONS-MANAGEDEDIT-001 y -002.
- [La muestra lee el staging en cada `getImport` en `AWAITING_MAPPING`] → como máximo 20 filas por índice `(import_job_id, row_number)`; el sondeo intenso es en `PERSISTING`, donde la muestra no se lee.

## Plan de migración

Migración expand sin datos. Rollback: la columna queda sin uso; la UI vuelve a no rotular. Las otras partes no tienen estado.

## Cambios a docs compartidos (al implementar)

- **docs/10:** `expectedBasis` en próximos pagos, `sampleRows` y `suggestedMapping` en `getImport`, y el criterio de `cardsWithoutPaymentCount` (D491).
- **docs/08:** columna `expected_basis` de `commitments.recurring_occurrence`.
- **docs/13 §7:** la muestra y el mapeo sugerido al retomar.
- **docs/17 y la matriz:** TC nuevos y TC-DEBT-CARD-033 modificado.
- **docs/38 §4:** tachar «Notas `LOAN_*`», «Rótulo de cuotas en Q8», «Q5 sin periodo» y «`getImport` sin filas de muestra», con el PR.

## Preguntas abiertas

Ninguna. El owner adoptó el 2026-11-25 las cinco recomendaciones ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md) § «Respuestas posteriores»):

| Pregunta | Decisión | Efecto en este change |
|---|---|---|
| 1. Tags en las transacciones de préstamo | D489: (a) el delta de `add-loans` dice «descripción y notas» | Corregidos el delta y el design de `add-loans` (decisión 10); este change ya editaba solo descripción y notas (decisión 1). |
| 2. Préstamo en borrador y tabla del banco con fechas distintas | D490: (a) quedan en docs/38 hasta que el owner cargue su préstamo real (`add-loans` 8.4) | Ninguno. |
| 3. «N tarjetas sin pago programado» en Q5 | D491: (a) se confirma el criterio de D213 | Decisión 6 y requirement «Aviso de tarjetas sin pago programado en el disponible» en `reporting/dashboard` (TC-REPORTING-SPENDABLE-017 y -018). |
| 4. `suggestedMapping` al retomar | D492: (b) `suggestedMapping` opcional en `ImportJobDetail` | Decisión 4, contrato y requirement «Mapeo sugerido al retomar una importación» (Could, TC-IMPORTS-CSV-034 y -035); tarea 6.5. |
| 5. Dónde va el arreglo de la muestra | D493: (a) en este change | Ninguno (decisión 5). |
