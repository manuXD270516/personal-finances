# Tareas

> Change 75 (Phase 9, docs/03 §7, D472 y D481; preguntas abiertas del design cerradas por D489–D493). Independiente de 72 a 74 y de los datos reales del owner. El delta de `reporting/cash-flow-calendar` modifica un requirement ya archivado (de `add-credit-cards`); los demás deltas son ADDED sobre specs existentes, así que el change se puede archivar en cualquier orden respecto de `add-loans`, `add-import-pipeline` y los changes de Phase 9. Sin consumidores ni conexiones nuevas (D249). Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas contra D481 y las respuestas del owner del 2026-11-25 (opción (a) `expected.basis` para el rótulo de cuotas, muestra al retomar, Q5 sin periodo); `openspec validate fix-phase-4-debt-followups --strict` (2026-11-26: revisados contra D481 y D489–D493; `openspec validate --strict` verde vía `pnpm spec:validate`)
- [x] 1.2 Revisar TC-TRANSACTIONS-MANAGEDEDIT-001..004, TC-REPORTING-UPCOMING-023..025, TC-REPORTING-SPENDABLE-016..018 y TC-IMPORTS-CSV-031..035 contra los scenarios; pasarlos a `ready` y `requirement_status: confirmed`. Actualizar TC-DEBT-CARD-033 (indicación «cuotas» y origen `INSTALLMENTS` en lo esperado) (2026-11-26: los 16 TC pasan a `automated` y `confirmed`; TC-DEBT-CARD-033 actualizado)
- [x] 1.3 Registrar en el siguiente `…-decisions.md` las respuestas a las preguntas abiertas 1 a 5 del design, si el owner las contesta antes del grupo que las usa (hecho el 2026-11-25: D489–D493 en docs/77; delta de `add-loans` corregido por D489)

## 2. DOMAIN (TDD)

- [x] 2.1 DEBT, test-first: `expectationForIssued`, `expectationForOpen` y `expectationForFuture` devuelven el origen (`STATEMENT`, `OPEN_CYCLE`, `INSTALLMENTS`); `sameExpectation` compara también el origen: TC-DEBT-CARD-033 y TC-REPORTING-UPCOMING-024/025 (2026-11-26)
- [x] 2.2 COMMITMENTS, test-first: la ocurrencia guarda el origen al fijar el esperado y lo limpia con `setExpected` sin origen, `unsettle`, `replaceSchedule` y la edición del usuario (2026-11-26)

## 3. APPLICATION

- [x] 3.1 COMMITMENTS: `setExpected` acepta `expectation.basis`; `UpcomingPaymentDto.expectedBasis` y `ManagedOccurrenceDto.expectedBasis` (aditivos) (2026-11-26)
- [x] 3.2 DEBT: `card-engine` pasa el origen a `setExpected`; el primer paso de `debt.card-daily` completa las ocurrencias existentes con origen `NULL`: TC-DEBT-CARD-033 (2026-11-26)
- [x] 3.3 REPORTING: `getUpcomingPayments` copia el origen a cada ítem: TC-REPORTING-UPCOMING-023..025 (2026-11-26)
- [x] 3.4 IMPORTS: `getImport` en `AWAITING_MAPPING` lee hasta 20 registros posteriores al encabezado del staging por `row_number`; en los demás estados no los lee: TC-IMPORTS-CSV-031..033 (2026-11-26)
- [x] 3.5 REPORTING: el test de Q5 sin periodo pasa a citar TC-REPORTING-SPENDABLE-016 (hoy cita el -011, que es de otro scenario); sin cambio de código productivo (2026-11-26)
- [x] 3.6 REPORTING: los tests de `cardsWithoutPaymentCount` citan TC-REPORTING-SPENDABLE-017 y -018 (criterio de D213 confirmado por D491: un pago programado menor que el mínimo cuenta como programado); agregar el caso que falte; sin cambio de código productivo (2026-11-26)

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand: `commitments.recurring_occurrence.expected_basis text NULL` con su `CHECK` (`NOT VALID` y validado en la misma migración); timestamp posterior a la última de `main`; sin backfill (D481) (2026-11-26)
- [x] 4.2 Repositorio de ocurrencias: lectura y escritura de `expected_basis`; export e import del workspace con la propiedad opcional en `contracts/export/v1/recurring-occurrences.schema.json` (un export anterior se importa con `NULL`) (2026-11-26)
- [x] 4.3 Tests de integración con PostgreSQL real: origen guardado y limpiado; ida y vuelta del export; muestra leída del staging: TC-REPORTING-UPCOMING-023 y TC-IMPORTS-CSV-031 (2026-11-26)
- [x] 4.4 `pnpm arch:check`: sin dependencias nuevas entre contextos (REPORTING sigue sin depender de DEBT) (2026-11-26)

## 5. API

- [x] 5.1 Contrato: `UpcomingPaymentItem.expectedBasis` (`x-extensible-enum`) y `ImportJobDetail` en el 200 de `getImport` (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores). Si `oasdiff` marcara el cambio de `$ref` de `getImport`, agregar `sampleRows` opcional directamente en `ImportJob` y dejar la nota en el design (2026-11-26)
- [x] 5.2 Tests de API: próximos pagos con el origen en los tres casos; `getImport` con y sin muestra según el estado; VIEWER lee la muestra; otro workspace ⇒ 404: TC-REPORTING-UPCOMING-023..025, TC-IMPORTS-CSV-031..033 y TC-REPORTING-SPENDABLE-016..018 (2026-11-26)

## 6. UI

- [x] 6.1 Detalle de transacción: «Editar descripción y notas» para `LOAN_DISBURSEMENT` y `LOAN_PAYMENT` no anuladas (formulario reducido con `If-Match`); sin edición para VIEWER ni anuladas: TC-TRANSACTIONS-MANAGEDEDIT-001, -003 y -004 (2026-11-26)
- [x] 6.2 Formulario de un cargo de tarjeta con monto, cuenta, fecha, moneda y categorías de las porciones de solo lectura, el aviso «Lo administra la tarjeta» y el enlace: TC-TRANSACTIONS-MANAGEDEDIT-002 (2026-11-26)
- [x] 6.3 Próximos pagos y tarjeta Q8: indicación «cuotas» cuando `expectedBasis = INSTALLMENTS`, con i18n es/en/pt: TC-REPORTING-UPCOMING-023 (2026-11-26)
- [x] 6.4 Asistente de importación: al retomar en `AWAITING_MAPPING` usa `sampleRows` de `getImport`; el aviso `mapping-no-sample` queda solo si la respuesta no la trae: TC-IMPORTS-CSV-031 (2026-11-26)
- [x] 6.5 (Could, D492) `suggestedMapping` opcional en `ImportJobDetail` en `AWAITING_MAPPING` (contrato aditivo junto con la tarea 5.1, lectura de `jobs.lastMapping` en `getImport`, test de API) y su uso al retomar para precargar el mapeo: TC-IMPORTS-CSV-034 y -035 (2026-11-26: hecho; `suggestedMapping` en `getImport` y precarga al retomar)

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter (también TC-DEBT-CARD-033) (2026-11-26)
- [x] 7.2 E2E: anotar un pago de préstamo del Demo desde la pantalla y retomar una importación CSV esperando mapeo, sin violaciones serias de axe: TC-TRANSACTIONS-MANAGEDEDIT-001 y TC-IMPORTS-CSV-031 (2026-11-26: E2E en `loans.spec.ts` y `csv-import.spec.ts`)
- [x] 7.3 Regresión en verde sin cambios: TC-REPORTING-UPCOMING-*, TC-DEBT-CARD-031..033, TC-REPORTING-SPENDABLE-*, TC-TRANSACTIONS-CARDCHARGE-*, TC-IMPORTS-CSV-* y los TC de transacciones de `add-loans` (2026-11-26)

## 8. DOCUMENTATION

- [x] 8.1 Aplicar design.md § «Cambios a docs compartidos» (docs/08, docs/10, docs/13 §7, docs/17 y docs/38 §4) (2026-11-26)
- [x] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check` (2026-11-26)
