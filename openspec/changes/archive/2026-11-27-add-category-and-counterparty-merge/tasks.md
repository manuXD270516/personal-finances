# Tareas

> Change 76 (Phase 9, docs/03 §7, D472 y D480; Could). Último de Phase 9; no depende de 72 a 75, pero sus participantes tocan datos de `add-rule-engine`, `add-rule-suggestions`, `add-loans`, `add-import-pipeline` y, si están fusionados, de 72 y 73. Los deltas son ADDED sobre `classification/categories`, `classification/counterparties` y `audit/lifecycle-timeline`, así que se puede archivar sin esperar a otros changes. Las seis preguntas abiertas del design se cerraron el 2026-11-25 con las recomendaciones (D494–D499, docs/77); el grupo 3 queda desbloqueado. La tarea 3.9 (D496) usa FORECAST (changes 64 y 65), los gastos atípicos (72) y las sugerencias de categoría (73), ya fusionados; el change se archiva después de ellos. Sin consumidores ni conexiones nuevas (D249). Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas contra D480 y las respuestas del owner a las preguntas abiertas 1 a 6 del design; registrar las respuestas en el siguiente `…-decisions.md` y ajustar los deltas si alguna cambia la recomendación; `openspec validate add-category-and-counterparty-merge --strict` (hecho el 2026-11-25: D494–D499 en docs/77; D496 suma el requirement de continuidad de la historia y TC-CLASSIFICATION-MERGE-028..030)
- [x] 1.2 Revisar TC-CLASSIFICATION-MERGE-001..030 y TC-AUDIT-LIFECYCLE-028..029 contra los scenarios. Cifras: 320.50 + 1240.00 = 1560.50 BOB; 512.40 BOB; 100.00 BOB en octubre cerrado. Pasarlos a `ready` y `requirement_status: confirmed` _(hecho el 2026-11-27: TC revisados y pasados a `automated`/`confirmed`)_

## 2. DOMAIN (TDD)

- [x] 2.1 CLASSIFICATION, test-first: `CategoryMergePolicy` (mismo workspace, distinta, mismo tipo, origen no de sistema, destino activa, ninguna fusionada, origen activa o archivada, subcategorías que se mueven, profundidad, nombres de hermanas): TC-CLASSIFICATION-MERGE-002..005, -010, -011, -013 y -020 _(2026-11-27: `merge-policy.test.ts`)_
- [x] 2.2 CLASSIFICATION, test-first: reglas de la fusión de contrapartes (alias que se mueven, nombre de la origen como alias si no colisiona, categoría por defecto según la pregunta abierta 5): TC-CLASSIFICATION-MERGE-021..023 _(2026-11-27: `merge-policy.test.ts` (alias, nombre como alias, categoría por defecto D498))_
- [x] 2.3 `Category` y `Counterparty`: estado fusionado (`mergedInto`, `mergedAt`), `unarchive` rechazado con `CATEGORY_MERGED` / `COUNTERPARTY_MERGED`: TC-CLASSIFICATION-MERGE-019, -020 y -027 _(2026-11-27: `merge-policy.test.ts`)_
- [x] 2.4 Máquinas `CATEGORY_LIFECYCLE` y `COUNTERPARTY_LIFECYCLE` versión 2 con `MERGE` y las anotaciones `MERGED_FROM` y `MOVED`; los recorridos de la versión 1 se leen igual: TC-AUDIT-LIFECYCLE-028 y -029 _(2026-11-27: máquinas v2 (`classification-lifecycle.ts`), `classification-lifecycle.test.ts` y `merge-policy.test.ts`)_

## 3. APPLICATION

- [x] 3.1 CLASSIFICATION: puerto `ClassificationMergeParticipant` en contracts; `MergeCategories` y `MergeCounterparties` (unidad de trabajo única, vista previa de todos los participantes, conflictos ⇒ `CLASSIFICATION_MERGE_CONFLICT`, `apply` en orden fijo y de a uno, marca, auditoría con `operationId`, evento al outbox); idempotencia: TC-CLASSIFICATION-MERGE-001, -007 y -009 _(2026-11-27: `merge.service.ts` y `merge.service.test.ts`)_
- [x] 3.2 CLASSIFICATION: consultas de vista previa (solo lectura, VIEWER): TC-CLASSIFICATION-MERGE-008 y -025 _(2026-11-27: vista previa en `merge.service.ts`; `category-merge.api.test.ts`)_
- [x] 3.3 TRANSACTIONS (participante): porciones y transacciones de periodos no cerrados por conjunto, con el mismo criterio de rango que `PERIOD_CLOSED`; proveedor de conversiones; anotación en el recorrido de cada transacción con el `operationId`: TC-CLASSIFICATION-MERGE-001, -014, -015, -021 y -024 _(2026-11-27: `transactions/.../pg-classification-merge.ts`; anotación por transacción con `recordMany`)_
- [x] 3.4 PLANNING (participante): líneas de planes no cerrados y conflicto `BUDGET_LINE_EXISTS`; versión nueva de las plantillas vigentes y conflicto `TEMPLATE_LINE_EXISTS`: TC-CLASSIFICATION-MERGE-009 y -016 _(2026-11-27: `planning/.../pg-classification-merge.ts`)_
- [x] 3.5 COMMITMENTS (participante): categoría y contraparte de las definiciones activas como anotación (sin versión ni cambio de ocurrencias); contraparte de las suscripciones: TC-CLASSIFICATION-MERGE-016 y -026 _(2026-11-27: `commitments/.../pg-classification-merge.ts` (migración que abre solo `category_id` y `counterparty_id` de la versión; ver el informe))_
- [x] 3.6 RULES (participante): versión nueva de cada regla no archivada que usa la origen (`changeReason = MERGE`), con condiciones duplicadas colapsadas: TC-CLASSIFICATION-MERGE-016 y -026 _(2026-11-27: `rules/.../classification-merge.participant.ts` (sin columna `changeReason`: la versión nueva y la auditoría con el `operationId` la identifican))_
- [x] 3.7 REPORTING, DEBT e IMPORTS (participantes): esenciales sin duplicar; prestamista; filas de importaciones en `AWAITING_MAPPING` o `AWAITING_REVIEW`: TC-CLASSIFICATION-MERGE-017, -018 y -026 _(2026-11-27: `reporting`, `debt` e `imports` (`pg-classification-merge.ts`))_
- [x] 3.8 CLASSIFICATION (participante propio): categoría por defecto de las contrapartes que usan la origen: TC-CLASSIFICATION-MERGE-017 _(2026-11-27: en `merge.service.ts` (CLASSIFICATION participante de sí misma))_
- [x] 3.9 (D496) `CategoryMergeQuery.resolve` en `@pf/classification/contracts` (destino vigente siguiendo la cadena) y su uso al leer la historia: FORECAST (preparación de las series por categoría y de la historia de los gastos atípicos) y RULES (sugerencias de categoría, que nunca proponen una categoría fusionada); los reportes por periodo no la usan: TC-CLASSIFICATION-MERGE-028..030 _(2026-11-27: `CategoryMergeQuery` (`pg-merge.ts`), `forecasting/.../merge-history.ts` y `rules/.../category-suggestions.ts`)_

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand: `merged_into_id` y `merged_at` en `classification.category` y `classification.counterparty`, con FK compuesta y los dos `CHECK`; timestamp posterior a la última de `main` _(2026-11-27: `20261127120000_classification_merge.sql` (más `…120100` y `…120200`, las excepciones estrechas de inmutabilidad))_
- [x] 4.2 Export e import del workspace con las columnas nuevas como propiedades opcionales (la destino antes que la origen); ida y vuelta verificada _(2026-11-27: `merged_into_id` como autorreferencia de las secciones `categories` y `counterparties`; ida y vuelta cubierta por los tests de export del workspace)_
- [x] 4.3 Esquemas `contracts/events/classification/CategoriesMerged.v1.schema.json` y `CounterpartiesMerged.v1.schema.json` con ejemplos; tests de contrato de eventos _(2026-11-27: `CategoriesMerged.v1` y `CounterpartiesMerged.v1` (agregado = la origen: el índice único del outbox exige `(agregado, tipo, versión)` distinto y la destino no cambia de versión))_
- [x] 4.4 Composición de los participantes en `apps/api`; test de arquitectura: todo contexto con una referencia a categoría o contraparte (lista cerrada de la tabla del design) implementa el puerto; `pnpm arch:check` sin ciclos (los participantes dependen de `@pf/classification/contracts`, no al revés) _(2026-11-27: `identity-wiring.ts` y `merge-participants.architecture.test.ts`; `arch:check` limpio)_
- [x] 4.5 Tests de integración con PostgreSQL real: fusión completa con todos los participantes; atomicidad (un participante que falla deja todo como estaba); RLS y aislamiento entre workspaces; sin consultas en paralelo sobre el mismo cliente: TC-CLASSIFICATION-MERGE-001, -014, -016 y -024 _(2026-11-27: `category-merge.api.test.ts` contra PostgreSQL real; atomicidad en `merge.service.test.ts`)_

## 5. API

- [x] 5.1 Contrato: `previewCategoryMerge`, `mergeCategory`, `previewCounterpartyMerge`, `mergeCounterparty`, sus esquemas, `mergedInto` en `Category` y `Counterparty`, y los códigos `CLASSIFICATION_MERGE_CONFLICT`, `CATEGORY_MERGED` y `COUNTERPARTY_MERGED` en `ErrorCode` (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores) _(2026-11-27: OpenAPI aditivo (`oasdiff` limpio). `CATEGORY_KIND_MISMATCH` y `CATEGORY_DEPTH_EXCEEDED` responden 422 (catálogo vigente), no 409)_
- [x] 5.2 Tests de API: roles, `If-Match`, `Idempotency-Key`, cuota `costly`, 404 de otro workspace, errores de dominio: TC-CLASSIFICATION-MERGE-006, -007, -018, -019, -025 y -027 _(2026-11-27: `category-merge.api.test.ts`)_
- [x] 5.3 Medición: fusión de una categoría con 10 000 porciones (objetivo de diseño < 10 s en CI, decisión 8); si no se alcanza, preguntar al owner antes de cambiar el enfoque _(2026-11-27: medido 14–15 s con 10 000 porciones en la máquina de desarrollo (objetivo 10 s); NO se cambió el enfoque y queda como pregunta al owner en el informe; el test fija un tope de 30 s)_

## 6. UI

- [x] 6.1 Categorías: acción «Fusionar en…» (OWNER y EDITOR) con selector de destino compatible, vista previa con conteos y conflictos, confirmación con el nombre de la destino; la origen fusionada se muestra «fusionada en <destino>»; i18n es/en/pt: TC-CLASSIFICATION-MERGE-001 y -009 _(2026-11-27: `MergeDialog.tsx` y `CategoriesPanel.tsx`)_
- [x] 6.2 Contrapartes: la misma acción, con los alias que se moverán: TC-CLASSIFICATION-MERGE-021 y -025 _(2026-11-27: `CounterpartiesPanel.tsx`)_
- [x] 6.3 Recorrido: transición «Fusionar» y anotación «Fusión desde»: TC-AUDIT-LIFECYCLE-028 _(2026-11-27: `lifecycle/logic.ts` y mensajes es/en/pt)_

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter _(2026-11-27: los 32 TC con su id en el nombre del test)_
- [x] 7.2 E2E: fusionar dos categorías del Demo con vista previa y confirmación, y verificar el reporte del mes; sin violaciones serias de axe: TC-CLASSIFICATION-MERGE-001 _(2026-11-27: `tests/e2e/specs/category-merge.spec.ts`)_
- [x] 7.3 Regresión en verde sin cambios: TC-CLASSIFICATION-ARCHIVE-*, -UNARCHIVE-*, TC-AUDIT-LIFECYCLE-015..018, TC-PLANNING-SNAPSHOT-*, TC-TRANSACTIONS-BULK-* y TC-RULES-ENGINE-* _(2026-11-27: regresión en verde (`turbo test` y `test:integration`))_

## 8. DOCUMENTATION

- [x] 8.1 Aplicar design.md § «Cambios a docs compartidos» (docs/01, 04, 08, 10, 11, nota a D52 en docs/31, docs/17, 25 y 38) _(2026-11-27)_
- [x] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check` _(2026-11-27)_
