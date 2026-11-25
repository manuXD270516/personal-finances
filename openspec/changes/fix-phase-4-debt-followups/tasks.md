# Tareas

> Change 75 (Phase 9, docs/03 §7, D472 y D481). Independiente de 72 a 74 y de los datos reales del owner. El delta de `reporting/cash-flow-calendar` modifica un requirement ya archivado (de `add-credit-cards`); los demás deltas son ADDED sobre specs existentes, así que el change se puede archivar en cualquier orden respecto de `add-loans`, `add-import-pipeline` y los changes de Phase 9. Sin consumidores ni conexiones nuevas (D249). Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas contra D481 y las respuestas del owner del 2026-11-25 (opción (a) `expected.basis` para el rótulo de cuotas, muestra al retomar, Q5 sin periodo); `openspec validate fix-phase-4-debt-followups --strict`
- [ ] 1.2 Revisar TC-TRANSACTIONS-MANAGEDEDIT-001..004, TC-REPORTING-UPCOMING-023..025, TC-REPORTING-SPENDABLE-016 y TC-IMPORTS-CSV-031..033 contra los scenarios; pasarlos a `ready` y `requirement_status: confirmed`. Actualizar TC-DEBT-CARD-033 (indicación «cuotas» y origen `INSTALLMENTS` en lo esperado)
- [ ] 1.3 Registrar en el siguiente `…-decisions.md` las respuestas a las preguntas abiertas 1 a 5 del design, si el owner las contesta antes del grupo que las usa

## 2. DOMAIN (TDD)

- [ ] 2.1 DEBT, test-first: `expectationForIssued`, `expectationForOpen` y `expectationForFuture` devuelven el origen (`STATEMENT`, `OPEN_CYCLE`, `INSTALLMENTS`); `sameExpectation` compara también el origen: TC-DEBT-CARD-033 y TC-REPORTING-UPCOMING-024/025
- [ ] 2.2 COMMITMENTS, test-first: la ocurrencia guarda el origen al fijar el esperado y lo limpia con `setExpected` sin origen, `unsettle`, `replaceSchedule` y la edición del usuario

## 3. APPLICATION

- [ ] 3.1 COMMITMENTS: `setExpected` acepta `expectation.basis`; `UpcomingPaymentDto.expectedBasis` y `ManagedOccurrenceDto.expectedBasis` (aditivos)
- [ ] 3.2 DEBT: `card-engine` pasa el origen a `setExpected`; el primer paso de `debt.card-daily` completa las ocurrencias existentes con origen `NULL`: TC-DEBT-CARD-033
- [ ] 3.3 REPORTING: `getUpcomingPayments` copia el origen a cada ítem: TC-REPORTING-UPCOMING-023..025
- [ ] 3.4 IMPORTS: `getImport` en `AWAITING_MAPPING` lee hasta 20 registros posteriores al encabezado del staging por `row_number`; en los demás estados no los lee: TC-IMPORTS-CSV-031..033
- [ ] 3.5 REPORTING: el test de Q5 sin periodo pasa a citar TC-REPORTING-SPENDABLE-016 (hoy cita el -011, que es de otro scenario); sin cambio de código productivo

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: `commitments.recurring_occurrence.expected_basis text NULL` con su `CHECK` (`NOT VALID` y validado en la misma migración); timestamp posterior a la última de `main`; sin backfill (D481)
- [ ] 4.2 Repositorio de ocurrencias: lectura y escritura de `expected_basis`; export e import del workspace con la propiedad opcional en `contracts/export/v1/recurring-occurrences.schema.json` (un export anterior se importa con `NULL`)
- [ ] 4.3 Tests de integración con PostgreSQL real: origen guardado y limpiado; ida y vuelta del export; muestra leída del staging: TC-REPORTING-UPCOMING-023 y TC-IMPORTS-CSV-031
- [ ] 4.4 `pnpm arch:check`: sin dependencias nuevas entre contextos (REPORTING sigue sin depender de DEBT)

## 5. API

- [ ] 5.1 Contrato: `UpcomingPaymentItem.expectedBasis` (`x-extensible-enum`) y `ImportJobDetail` en el 200 de `getImport` (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores). Si `oasdiff` marcara el cambio de `$ref` de `getImport`, agregar `sampleRows` opcional directamente en `ImportJob` y dejar la nota en el design
- [ ] 5.2 Tests de API: próximos pagos con el origen en los tres casos; `getImport` con y sin muestra según el estado; VIEWER lee la muestra; otro workspace ⇒ 404: TC-REPORTING-UPCOMING-023..025, TC-IMPORTS-CSV-031..033 y TC-REPORTING-SPENDABLE-016

## 6. UI

- [ ] 6.1 Detalle de transacción: «Editar descripción y notas» para `LOAN_DISBURSEMENT` y `LOAN_PAYMENT` no anuladas (formulario reducido con `If-Match`); sin edición para VIEWER ni anuladas: TC-TRANSACTIONS-MANAGEDEDIT-001, -003 y -004
- [ ] 6.2 Formulario de un cargo de tarjeta con monto, cuenta, fecha, moneda y categorías de las porciones de solo lectura, el aviso «Lo administra la tarjeta» y el enlace: TC-TRANSACTIONS-MANAGEDEDIT-002
- [ ] 6.3 Próximos pagos y tarjeta Q8: indicación «cuotas» cuando `expectedBasis = INSTALLMENTS`, con i18n es/en/pt: TC-REPORTING-UPCOMING-023
- [ ] 6.4 Asistente de importación: al retomar en `AWAITING_MAPPING` usa `sampleRows` de `getImport`; el aviso `mapping-no-sample` queda solo si la respuesta no la trae: TC-IMPORTS-CSV-031
- [ ] 6.5 (Could, solo si el owner elige (b) en la pregunta abierta 4) `suggestedMapping` opcional en `ImportJobDetail` y su uso al retomar

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter (también TC-DEBT-CARD-033)
- [ ] 7.2 E2E: anotar un pago de préstamo del Demo desde la pantalla y retomar una importación CSV esperando mapeo, sin violaciones serias de axe: TC-TRANSACTIONS-MANAGEDEDIT-001 y TC-IMPORTS-CSV-031
- [ ] 7.3 Regresión en verde sin cambios: TC-REPORTING-UPCOMING-*, TC-DEBT-CARD-031..033, TC-REPORTING-SPENDABLE-*, TC-TRANSACTIONS-CARDCHARGE-*, TC-IMPORTS-CSV-* y los TC de transacciones de `add-loans`

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos» (docs/08, docs/10, docs/13 §7, docs/17 y docs/38 §4)
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
