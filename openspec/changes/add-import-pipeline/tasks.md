# Tareas

> Pipeline completo de Phase 6 (FR-IMPORTS-001..012, 017; FR-TRANSACTIONS-032). Requiere aplicados `optimize-consumer-throughput`, `add-bulk-imported-transactions`, `add-document-attachments` y `add-rule-engine` (ver design.md § Dependencias). Sin consumidores nuevos (D249). Los extractos reales del owner nunca entran al repositorio ni a CI (D255, D281): todo fixture es sintético y marcado SINTETICO. Sin Docker en la sesión, `pnpm test:integration`, `pnpm test:e2e` y `pnpm perf:bench` los valida CI; se dice en el informe.
>
> **Orden de implementación.** Grupo 1 → 2 (dominio) → 3 (TRANSACTIONS) → 4 (aplicación) → 5 (infraestructura y lectores) → 6 (API) → 7 (UI) → 8 (pruebas) → 9 (docs). Las preguntas abiertas no bloquean el orden; la 1 bloquea la verificación del criterio de salida con extractos reales (tarea 8.7).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `imports/import-pipeline`, `transactions/duplicate-detection` y `audit/lifecycle-timeline`; `pnpm exec openspec validate add-import-pipeline --strict`
- [ ] 1.2 Revisar TC-IMPORTS-PIPELINE-002..071 y TC-TRANSACTIONS-DEDUPE-001..014 contra los scenarios (cifras: 0.40 + 0.20 + 0.20 + 0.05 + 0.05 = 0.9000; 0.40 + 0.075 + 0 + 0.05 + 0.05 = 0.5750; 52 + 75 − 12 = 115; 11964.00 − 8036.00 = 4000.00; 11964.00 + 36.00 = 12000.00; 41 / 57 = 0.7193; 696.00 / 100.00 = 6.96); pasarlos a `ready`
- [ ] 1.3 Verificación cruzada de contratos con `add-document-attachments` (decisión 14), `add-rule-engine` (decisión 4 y § Contratos) y `add-banking-providers` (§ Dependencias a–f); registrar cualquier diferencia en design.md antes de codificar
- [ ] 1.4 Fixtures sintéticos en `tests/fixtures/imports/`: OFX 1.x SGML y 2.x XML, QIF banco y tarjeta, JSON v1 válido e inválido, XLSX con fórmula y número no representable, CSV con pie, D/C, descripción en dos columnas, alias de moneda y referencia repetida; los tres meses solapados (`enero-15feb.csv`, `feb-mar.ofx`); generador de 5 000 movimientos (no versionado)
- [ ] 1.5 Esquemas `contracts/imports/import-file.v1.schema.json` e `imports.profile.v1` (JSON Schema)

## 2. DOMAIN (TDD)

- [ ] 2.1 `ImportJob` con la máquina de la decisión 4 (transiciones válidas e inválidas, actor, etapa y punto de control) test-first (TC-IMPORTS-PIPELINE-007, -010, -071)
- [ ] 2.2 `MappingProfile` (versiones inmutables, validación, archivo) y `ProfileMatcher` (cuenta antes que institución, columnas obligatorias sin mayúsculas ni acentos, faltantes) test-first (TC-IMPORTS-PIPELINE-025..031)
- [ ] 2.3 Normalizador ampliado test-first: pie, indicador D/C, descripción multicolumna, alias de moneda, referencia única o no, hora, número ambiguo, limpieza por prefijos literales; PBT de montos `parse(format(m)) == m` sin `number` (TC-IMPORTS-PIPELINE-032..035, -053)
- [ ] 2.4 Verificador de saldo corrido en el orden del archivo y diferencia contra el saldo final test-first (TC-IMPORTS-PIPELINE-036, -037)
- [ ] 2.5 `RowEdits` con origen por campo sobre la propuesta de reglas; reevaluar conserva `MANUAL` test-first (TC-IMPORTS-PIPELINE-039, -041..043)
- [ ] 2.6 Filas `TRANSFER` y `CONVERSION` (validación de moneda y escala de la contraparte, tasa efectiva exacta) test-first (TC-IMPORTS-PIPELINE-044..047)
- [ ] 2.7 `RevertPlan` (anulables, ya anuladas, bloqueadas por reconciliación o periodo cerrado; todo o nada salvo parcial explícito) test-first (TC-IMPORTS-PIPELINE-059..062)

## 3. TRANSACTIONS (contratos aditivos, TDD)

- [ ] 3.1 `DuplicateScore` (dominio puro: señales, pesos, Jaro-Winkler sobre descripciones normalizadas, `Decimal` 4 decimales HALF_EVEN, orden y desempate) test-first con PBT de determinismo (TC-TRANSACTIONS-DEDUPE-001..003)
- [ ] 3.2 `DuplicateCandidatesQuery.findForImport` con puntaje, señales e identificador del banco; integración set-based (TC-TRANSACTIONS-DEDUPE-006..008)
- [ ] 3.3 Referencias `imports.ext:<FORMAT>` y migración del índice único parcial `transaction_import_ext_ref_uk` (`CONCURRENTLY`); dos imports simultáneos y liberación al anular (TC-TRANSACTIONS-DEDUPE-004, -005)
- [ ] 3.4 `recordBatch` con `kind`, `transfer` y `conversion` (por los servicios existentes dentro del lote) y con `classification` de `add-rule-engine`; ampliar el test de equivalencia de `add-bulk-imported-transactions`
- [ ] 3.5 `ImportedConversionsCommand.recordBatch` (si `add-banking-providers` no lo implementó antes) con la referencia resuelta al instante (pregunta 3) (TC-IMPORTS-PIPELINE-046)
- [ ] 3.6 `ImportedTransactionsCommand.voidBatch` y `LedgerPostingPort.reverseJournalEntries` por conjunto; reversa exacta (INV-008) y periodo cerrado bloquea (TC-IMPORTS-PIPELINE-059..061)

## 4. APPLICATION

- [ ] 4.1 `CreateImportFromDocument` (rol, cuenta, documento disponible y de propósito correcto, formato importable, vínculo en la misma UoW, auditoría, outbox `ImportFileUploaded.v1`) (TC-IMPORTS-PIPELINE-004..006, -012)
- [ ] 4.2 `ProcessImport` en el consumidor `imports.persist`: etapas por bloques de 1 000 con punto de control, reanudación, cancelación, `PARSE_FAILED`, límites y tiempo máximo (TC-IMPORTS-PIPELINE-007..010, -067, -068)
- [ ] 4.3 Etapa de clasificación: alias, `RulesEvaluationPort` por bloques de 5 000, categoría por defecto, «sin categoría»; falla ⇒ `IMPORT_RULES_UNAVAILABLE` (TC-IMPORTS-PIPELINE-038, -040)
- [ ] 4.4 Etapas de duplicados (exactos por huella e identificador, dentro del archivo, probables con puntaje y preselección) y de compromisos (bloques de 500, hasta 3 candidatas) (TC-IMPORTS-PIPELINE-002, -052..054; TC-TRANSACTIONS-DEDUPE-006..008, -012, -013)
- [ ] 4.5 Perfiles: guardar, versionar, archivar, aplicar automáticamente y `AWAITING_MAPPING` con candidatos y faltantes (TC-IMPORTS-PIPELINE-025..031)
- [ ] 4.6 Edición por fila y en lote, reevaluar reglas, confirmar coincidencias (por fila y de confianza alta), saldo del extracto (TC-IMPORTS-PIPELINE-039, -041..043, -048..050)
- [ ] 4.7 `PersistImport` ampliado: clasificación de la vista previa, transferencias y conversiones, vínculos con ocurrencias tras cada lote (`IMPORT_OCCURRENCE_LINK_SKIPPED`), auditoría de cada fusión, reconciliación final (`COMPLETED`/`COMPLETED_WITH_DIFFERENCE`, sin ajuste) y resumen con cobertura de reglas (TC-IMPORTS-PIPELINE-003, -051, -057, -058, -064, -069; TC-TRANSACTIONS-DEDUPE-009..011)
- [ ] 4.8 `PreviewRevert`, `RevertImport` y `ProcessRevert` (lotes de 200, vínculos `SUPERSEDED`, idempotente, `ImportReverted.v1`) (TC-IMPORTS-PIPELINE-059..062; TC-TRANSACTIONS-DEDUPE-014)
- [ ] 4.9 Recorrido: máquina `IMPORT_JOB_LIFECYCLE` en AUDIT con anotaciones de perfil, reevaluación y aceptación de errores (TC-IMPORTS-PIPELINE-070, -071)

## 5. INFRASTRUCTURE

- [ ] 5.1 Migraciones expand: `imports.mapping_profile` (RLS forzada, grants, `platform.workspace_scoped_table`), columnas nullable de `import_job`, `staged_transaction` y `row_link`, CHECK de `status` y `source` ampliados; tests de RLS y permisos
- [ ] 5.2 Lectores: OFX 1.x SGML tolerante y 2.x XML sin DTD ni entidades externas, QIF, JSON con JSON Schema, XLSX (Could) con valor guardado y representación decimal más corta; golden files con comparación estructural exacta (TC-IMPORTS-PIPELINE-011, -013..024)
- [ ] 5.3 Adaptadores de puertos: `DocumentSourcePort`, `RulesEvaluationPort`, `CounterpartyResolverPort`, `OccurrenceMatchingPort`, `OccurrenceLinkingPort`, `InstitutionOfAccountPort` en la composición de `apps/api`; `pnpm arch:check` sin ciclos
- [ ] 5.4 `ImportJobExistenceQuery` en `@pf/imports/contracts` (si `add-document-attachments` no la agregó)
- [ ] 5.5 Portabilidad: sección `import-mapping-profiles` y columnas nuevas en el export e import del workspace, con JSON Schema; ida y vuelta en verde
- [ ] 5.6 Config `IMPORT_MAX_ROWS`, `IMPORT_PROCESSING_TIMEOUT`, `IMPORT_DUPLICATE_HIGH_SCORE`, `IMPORT_DUPLICATE_LOW_SCORE` en `@pf/platform` y `docs/config-reference.md` (`pnpm config:docs`); test de arranque del worker con la plantilla del host (32 de 34, sin consumidores nuevos)

## 6. API y eventos

- [ ] 6.1 Operaciones de design.md § Contratos en `contracts/openapi/finance-api.v1.yaml` (variante JSON de `createImport`, campos nuevos de `ImportJob` y de la vista previa, edición, lote, reglas, coincidencias, saldo, deshacer, perfiles), `ErrorCode` y `ImportRowIssueCode` con mensajes es/en/pt; `pnpm contract:breaking`, Spectral y Redocly limpios
- [ ] 6.2 Esquemas `contracts/events/imports/` nuevos y `ImportCompleted.v1` con enums abiertos; `contracts/events/README.md`
- [ ] 6.3 Tests de API con respuestas validadas contra el OpenAPI: roles (TC-IMPORTS-PIPELINE-063), concurrencia (-043), errores (-005, -006, -012, -027, -045, -060), cuota costosa y reproducción idempotente de `createImport` y `revertImport`
- [ ] 6.4 Marcar `deprecated` la variante `multipart` de `createImport` cuando la UI use solo documentos (pregunta 9); sin quitarla

## 7. UI

- [ ] 7.1 Asistente de importación desde la cuenta y desde Transacciones: subir el extracto como documento (componente de `add-document-attachments`), progreso por etapa con `aria-live`, perfil aplicado o asistente de mapeo con candidatos y columnas faltantes y «guardar como perfil»
- [ ] 7.2 Revisión: filtros (nuevas, ya importadas, posibles duplicados por confianza, inválidas, sin categoría, por regla), candidatos con puntaje y señales, preselección editable, edición por fila y en lote, origen por campo (regla y versión), transferencia y conversión, coincidencias con compromisos y «confirmar las de confianza alta», saldo del extracto y diferencia; textos importados escapados
- [ ] 7.3 Resultado: conteos, cobertura de reglas, oferta de reconciliación o diferencia, advertencias; deshacer con vista previa de bloqueadas y opción parcial; recorrido del import
- [ ] 7.4 Página de perfiles (listado por institución, versiones, archivar); i18n es/en/pt y formato es-BO

## 8. AUTOMATED TESTS y E2E

- [ ] 8.1 Automatizar TC-IMPORTS-PIPELINE-002..071 y TC-TRANSACTIONS-DEDUPE-001..014 con el TC-ID en el nombre; actualizar front matter
- [ ] 8.2 Integración con PostgreSQL real: documento → etapas → revisión → aprobación → asientos cuadrados por moneda (INV-004) → reconciliación; interrupción y reanudación sin duplicados; dos aprobaciones simultáneas (TC-IMPORTS-PIPELINE-008; TC-TRANSACTIONS-DEDUPE-004)
- [ ] 8.3 PBT del criterio de salida sintético: tres meses solapados en CSV y OFX ⇒ 115 transacciones; reimportar cualquiera ⇒ 0 (TC-IMPORTS-PIPELINE-055, -056)
- [ ] 8.4 Seguridad: XML con entidad externa rechazado sin resolverla, fórmula no evaluada, 5 001 filas y 51 columnas cortan la lectura (TC-IMPORTS-PIPELINE-023, -067, -068); la suite de uploads maliciosos es de `add-document-attachments`
- [ ] 8.5 Benchmark `imports.perf.ts`: OFX de 5 000 movimientos con 200 reglas activas ⇒ revisión ≤ 30 s (TC-IMPORTS-PIPELINE-066); la fila del CSV básico sigue igual
- [ ] 8.6 E2E con `PF_E2E_PROJECT=pfos-e2e-<nombre>`: importar un OFX sintético, resolver un posible duplicado preseleccionado, marcar una transferencia, confirmar una coincidencia, aprobar, ver la reconciliación ofrecida, deshacer y reimportar; `a11y.spec` incluye `/imports`
- [ ] 8.7 Criterio de salida con datos reales (manual, del owner, fuera del repositorio): importar 3 meses de extractos reales sin duplicados y reimportar ⇒ 0; registrar solo conteos, sin montos ni descripciones (depende de la pregunta 1)

## 9. DOCUMENTATION

- [ ] 9.1 Actualizar los docs de design.md § «Cambios a docs compartidos», el runbook de importación y la matriz de trazabilidad
- [ ] 9.2 Al archivar: reescribir el `## Purpose` de `imports/import-pipeline` (ya no es solo el subconjunto CSV) y de `transactions/duplicate-detection`; `pnpm spec:validate` y `pnpm traceability:check`
- [ ] 9.3 Preguntas abiertas 1–9 consolidadas en el doc de preguntas de Phase 6 con sus respuestas antes de archivar
