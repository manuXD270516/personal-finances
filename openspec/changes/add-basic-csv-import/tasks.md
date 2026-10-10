# Tareas

> **Change opcional (Could, FR-IMPORTS-003).** No iniciar sin la respuesta del owner a la pregunta abierta 1 de design.md (Phase 3 o Phase 6). Requiere aplicados los changes de Phase 1/2, `improve-event-throughput` (D112) y `fix-phase-2-gaps` (D113); ver design.md § Dependencias. Recomendado como último change de Phase 3.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `imports/import-pipeline` (subconjunto CSV) y las preguntas abiertas 1–7 de design.md; verificar con `openspec validate add-basic-csv-import --strict`
- [ ] 1.2 Revisar TC-IMPORTS-CSV-001..030 contra los scenarios (cifras a mano: 4000.00 − 281.30 + 8000.00 = 11718.70 BOB; 4000.00 − 36.00 + 8000.00 = 11964.00 BOB; `FixedClock` 2026-10-20 en America/La_Paz); pasar a `ready` y `requirement_status: confirmed` al aprobar
- [ ] 1.3 Golden files anonimizados en `tests/fixtures/imports/csv/` (docs/13 §16.1): `extracto-octubre` (windows-1252, `;`, coma decimal), débito/crédito, tarjeta con cargos positivos, fechas `MM/dd/yyyy`, `identical-rows-same-day`, `formula-description`, `latin1-accents`, `utf8-bom`, binario renombrado; generador de 5 000 filas (no versionado)

## 2. DOMAIN (TDD)

- [ ] 2.1 `ImportJob` (estados del subconjunto, transiciones válidas/inválidas, contadores, versión) test-first (TC-IMPORTS-CSV-022, -025)
- [ ] 2.2 `CsvSniffer` (BOM, UTF-8 estricto, windows-1252, binario, delimitador, columnas) test-first (TC-IMPORTS-CSV-001, -005)
- [ ] 2.3 `CsvMapping` + `RowNormalizer` test-first: signo y convención, débito/crédito, separador decimal y de miles, paréntesis y signo final, escala exacta sin redondeo, formatos de fecha estrictos, descripción saneada y truncada (TC-IMPORTS-CSV-006..012, -026); PBT: `parse(format(m, locale)) == m` para todo monto y escala, y nunca se produce un `number`
- [ ] 2.4 `RowValidator` (cero, fecha futura con tolerancia en la zona del workspace, periodo cerrado vía puerto) test-first (TC-IMPORTS-CSV-013, -014)
- [ ] 2.5 `RowFingerprint` + `occurrenceIndex` test-first; PBT: la huella es estable ante reordenar filas no idénticas, y `import(f); import(f)` ⇒ 0 creaciones (INV-014) (TC-IMPORTS-CSV-016, -017, -018)
- [ ] 2.6 `DuplicateClassifier` (exacto por vínculo activo, vínculo superado si la transacción está anulada, probable con asignación 1:1 determinista) test-first (TC-IMPORTS-CSV-020, -021)
- [ ] 2.7 `ImportBatchPlanner` (lotes de 200 por fecha y línea; reanudación saltando filas con transacción) test-first (TC-IMPORTS-CSV-024)

## 3. APPLICATION

- [ ] 3.1 `CreateCsvImport` (rol, cuenta activa, límites, checksum y advertencia de archivo ya importado, staging por chunks, auditoría) (TC-IMPORTS-CSV-001..005, -019, -027)
- [ ] 3.2 `SetImportMapping` y `GetImportPreview` (normalización, validación, huellas, vínculos, candidatos set-based, totales y saldo resultante; sin efectos financieros) (TC-IMPORTS-CSV-006, -015)
- [ ] 3.3 `DecideImportRow`, `ApproveImport` (`IMPORT_REVIEW_INCOMPLETE`, outbox `ImportApproved.v1`, auditoría) y `CancelImport` (TC-IMPORTS-CSV-022, -025)
- [ ] 3.4 `PersistImport` (consumidor `imports.persist`: un lote = una transacción de BD con `recordBatch` + staging + `row_link` + progreso; error de dominio por lote; reanudación; `ImportCompleted.v1`), `RetryImport` y `AcceptImportErrors` (TC-IMPORTS-CSV-023, -024)
- [ ] 3.5 Jobs `imports.expire-reviews` y `imports.purge-staging` (TC-IMPORTS-CSV-030)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: schema `imports`, `import_job`, `staged_transaction`, `row_link` con RLS forzada y grants; registro en `platform.workspace_scoped_table`; tests de RLS y permisos
- [ ] 4.2 TRANSACTIONS: columna `import_job_id`, índice único parcial `transaction_import_ref_uk` (`CONCURRENTLY`), contratos `ImportedTransactionsCommand.recordBatch`, `DuplicateCandidatesQuery.findForImport` (incluye patas de transferencias y conversiones) y `TransactionStatusQuery.statusOf`; tests de contrato y TC-TRANSACTIONS-* en verde
- [ ] 4.3 PLANNING: el consumidor `planning.budget-thresholds` evalúa una vez por workspace por lote (coalescencia); TC-PLANNING-THRESHOLD-* en verde
- [ ] 4.4 Secciones `imports.import_job` y `imports.row_link` (y columna `import_job_id`) en el export/import del workspace; `staged_transaction` declarada excluida en el test de cobertura de tablas
- [ ] 4.5 Config `IMPORT_*` en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`)

## 5. API

- [ ] 5.1 Operaciones de design.md § Contratos en `contracts/openapi/finance-api.v1.yaml` (multipart con límite al leer el stream, `x-rate-limit: costly`, `If-Match`, `Idempotency-Key` con payload `{fileSha256, accountId}`), códigos nuevos en `ErrorCode` y mensajes es/en/pt; esquemas `contracts/events/imports/*.v1.schema.json`; oasdiff sin cambios rompedores
- [ ] 5.2 Tests de API: 413/422/409, VIEWER `INSUFFICIENT_ROLE`, cuota costosa y replay, 202 + polling con `ETag` (TC-IMPORTS-CSV-003, -004, -005, -027, -028)

## 6. UI

- [ ] 6.1 Asistente "Importar CSV" desde el detalle de la cuenta y desde Transacciones: subir → mapear (muestra de 20 filas, selects por columna, formato de fecha, separador decimal, convención de signo, precarga del último mapeo) → revisar (filtros por clasificación, candidato del posible duplicado con crear/omitir, filas inválidas con línea y motivo, advertencia de transferencias, totales y saldo resultante) → aprobar → progreso con `aria-live` y resultado; textos importados escapados; i18n es/en/pt (docs/28 §4.7)

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-IMPORTS-CSV-001..030 con el TC-ID en el nombre; actualizar front matter
- [ ] 7.2 Integración con PG real: subir → mapear → aprobar → asientos balanceados por moneda (INV-004) y saldo resultante; reimportar ⇒ 0 creaciones; caída del worker a mitad de la persistencia y reanudación sin duplicados; dos aprobaciones paralelas sin duplicados (TC-IMPORTS-CSV-016, -023, -024)
- [ ] 7.3 Benchmark nightly (`pnpm perf:bench`): 5 000 filas hasta la vista previa ≤ 30 s, persistencia ≤ 20 s, backlog de cada consumidor (incluidos `planning.budget-thresholds` y los de Phase 3) drenado ≤ 120 s (TC-IMPORTS-CSV-029)
- [ ] 7.4 E2E: importar `extracto-octubre`, decidir un posible duplicado, aprobar y ver las transacciones "sin categoría" en el listado; reimportar y ver 0 nuevas

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar los docs de design.md § "Cambios a docs compartidos" (docs/01, 03, 05, 08, 10, 11, 13, 24, 28, config-reference, ARCHITECTURE §14), runbook "Importar un extracto CSV" y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
