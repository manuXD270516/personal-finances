# Tareas

> Change 76 (Phase 9, docs/03 §7, D472 y D480; Could). Último de Phase 9; no depende de 72 a 75, pero sus participantes tocan datos de `add-rule-engine`, `add-rule-suggestions`, `add-loans`, `add-import-pipeline` y, si están fusionados, de 72 y 73. Los deltas son ADDED sobre `classification/categories`, `classification/counterparties` y `audit/lifecycle-timeline`, así que se puede archivar sin esperar a otros changes. Las seis preguntas abiertas del design se cerraron el 2026-11-25 con las recomendaciones (D494–D499, docs/77); el grupo 3 queda desbloqueado. La tarea 3.9 (D496) usa FORECAST (changes 64 y 65), los gastos atípicos (72) y las sugerencias de categoría (73), ya fusionados; el change se archiva después de ellos. Sin consumidores ni conexiones nuevas (D249). Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas contra D480 y las respuestas del owner a las preguntas abiertas 1 a 6 del design; registrar las respuestas en el siguiente `…-decisions.md` y ajustar los deltas si alguna cambia la recomendación; `openspec validate add-category-and-counterparty-merge --strict` (hecho el 2026-11-25: D494–D499 en docs/77; D496 suma el requirement de continuidad de la historia y TC-CLASSIFICATION-MERGE-028..030)
- [ ] 1.2 Revisar TC-CLASSIFICATION-MERGE-001..030 y TC-AUDIT-LIFECYCLE-028..029 contra los scenarios. Cifras: 320.50 + 1240.00 = 1560.50 BOB; 512.40 BOB; 100.00 BOB en octubre cerrado. Pasarlos a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 CLASSIFICATION, test-first: `CategoryMergePolicy` (mismo workspace, distinta, mismo tipo, origen no de sistema, destino activa, ninguna fusionada, origen activa o archivada, subcategorías que se mueven, profundidad, nombres de hermanas): TC-CLASSIFICATION-MERGE-002..005, -010, -011, -013 y -020
- [ ] 2.2 CLASSIFICATION, test-first: reglas de la fusión de contrapartes (alias que se mueven, nombre de la origen como alias si no colisiona, categoría por defecto según la pregunta abierta 5): TC-CLASSIFICATION-MERGE-021..023
- [ ] 2.3 `Category` y `Counterparty`: estado fusionado (`mergedInto`, `mergedAt`), `unarchive` rechazado con `CATEGORY_MERGED` / `COUNTERPARTY_MERGED`: TC-CLASSIFICATION-MERGE-019, -020 y -027
- [ ] 2.4 Máquinas `CATEGORY_LIFECYCLE` y `COUNTERPARTY_LIFECYCLE` versión 2 con `MERGE` y las anotaciones `MERGED_FROM` y `MOVED`; los recorridos de la versión 1 se leen igual: TC-AUDIT-LIFECYCLE-028 y -029

## 3. APPLICATION

- [ ] 3.1 CLASSIFICATION: puerto `ClassificationMergeParticipant` en contracts; `MergeCategories` y `MergeCounterparties` (unidad de trabajo única, vista previa de todos los participantes, conflictos ⇒ `CLASSIFICATION_MERGE_CONFLICT`, `apply` en orden fijo y de a uno, marca, auditoría con `operationId`, evento al outbox); idempotencia: TC-CLASSIFICATION-MERGE-001, -007 y -009
- [ ] 3.2 CLASSIFICATION: consultas de vista previa (solo lectura, VIEWER): TC-CLASSIFICATION-MERGE-008 y -025
- [ ] 3.3 TRANSACTIONS (participante): porciones y transacciones de periodos no cerrados por conjunto, con el mismo criterio de rango que `PERIOD_CLOSED`; proveedor de conversiones; anotación en el recorrido de cada transacción con el `operationId`: TC-CLASSIFICATION-MERGE-001, -014, -015, -021 y -024
- [ ] 3.4 PLANNING (participante): líneas de planes no cerrados y conflicto `BUDGET_LINE_EXISTS`; versión nueva de las plantillas vigentes y conflicto `TEMPLATE_LINE_EXISTS`: TC-CLASSIFICATION-MERGE-009 y -016
- [ ] 3.5 COMMITMENTS (participante): categoría y contraparte de las definiciones activas como anotación (sin versión ni cambio de ocurrencias); contraparte de las suscripciones: TC-CLASSIFICATION-MERGE-016 y -026
- [ ] 3.6 RULES (participante): versión nueva de cada regla no archivada que usa la origen (`changeReason = MERGE`), con condiciones duplicadas colapsadas: TC-CLASSIFICATION-MERGE-016 y -026
- [ ] 3.7 REPORTING, DEBT e IMPORTS (participantes): esenciales sin duplicar; prestamista; filas de importaciones en `AWAITING_MAPPING` o `AWAITING_REVIEW`: TC-CLASSIFICATION-MERGE-017, -018 y -026
- [ ] 3.8 CLASSIFICATION (participante propio): categoría por defecto de las contrapartes que usan la origen: TC-CLASSIFICATION-MERGE-017
- [ ] 3.9 (D496) `CategoryMergeQuery.resolve` en `@pf/classification/contracts` (destino vigente siguiendo la cadena) y su uso al leer la historia: FORECAST (preparación de las series por categoría y de la historia de los gastos atípicos) y RULES (sugerencias de categoría, que nunca proponen una categoría fusionada); los reportes por periodo no la usan: TC-CLASSIFICATION-MERGE-028..030

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: `merged_into_id` y `merged_at` en `classification.category` y `classification.counterparty`, con FK compuesta y los dos `CHECK`; timestamp posterior a la última de `main`
- [ ] 4.2 Export e import del workspace con las columnas nuevas como propiedades opcionales (la destino antes que la origen); ida y vuelta verificada
- [ ] 4.3 Esquemas `contracts/events/classification/CategoriesMerged.v1.schema.json` y `CounterpartiesMerged.v1.schema.json` con ejemplos; tests de contrato de eventos
- [ ] 4.4 Composición de los participantes en `apps/api`; test de arquitectura: todo contexto con una referencia a categoría o contraparte (lista cerrada de la tabla del design) implementa el puerto; `pnpm arch:check` sin ciclos (los participantes dependen de `@pf/classification/contracts`, no al revés)
- [ ] 4.5 Tests de integración con PostgreSQL real: fusión completa con todos los participantes; atomicidad (un participante que falla deja todo como estaba); RLS y aislamiento entre workspaces; sin consultas en paralelo sobre el mismo cliente: TC-CLASSIFICATION-MERGE-001, -014, -016 y -024

## 5. API

- [ ] 5.1 Contrato: `previewCategoryMerge`, `mergeCategory`, `previewCounterpartyMerge`, `mergeCounterparty`, sus esquemas, `mergedInto` en `Category` y `Counterparty`, y los códigos `CLASSIFICATION_MERGE_CONFLICT`, `CATEGORY_MERGED` y `COUNTERPARTY_MERGED` en `ErrorCode` (aditivo; `pnpm contract:breaking` limpio; Spectral y Redocly sin errores)
- [ ] 5.2 Tests de API: roles, `If-Match`, `Idempotency-Key`, cuota `costly`, 404 de otro workspace, errores de dominio: TC-CLASSIFICATION-MERGE-006, -007, -018, -019, -025 y -027
- [ ] 5.3 Medición: fusión de una categoría con 10 000 porciones (objetivo de diseño < 10 s en CI, decisión 8); si no se alcanza, preguntar al owner antes de cambiar el enfoque

## 6. UI

- [ ] 6.1 Categorías: acción «Fusionar en…» (OWNER y EDITOR) con selector de destino compatible, vista previa con conteos y conflictos, confirmación con el nombre de la destino; la origen fusionada se muestra «fusionada en <destino>»; i18n es/en/pt: TC-CLASSIFICATION-MERGE-001 y -009
- [ ] 6.2 Contrapartes: la misma acción, con los alias que se moverán: TC-CLASSIFICATION-MERGE-021 y -025
- [ ] 6.3 Recorrido: transición «Fusionar» y anotación «Fusión desde»: TC-AUDIT-LIFECYCLE-028

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test y actualizar el front matter
- [ ] 7.2 E2E: fusionar dos categorías del Demo con vista previa y confirmación, y verificar el reporte del mes; sin violaciones serias de axe: TC-CLASSIFICATION-MERGE-001
- [ ] 7.3 Regresión en verde sin cambios: TC-CLASSIFICATION-ARCHIVE-*, -UNARCHIVE-*, TC-AUDIT-LIFECYCLE-015..018, TC-PLANNING-SNAPSHOT-*, TC-TRANSACTIONS-BULK-* y TC-RULES-ENGINE-*

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos» (docs/01, 04, 08, 10, 11, nota a D52 en docs/31, docs/17, 25 y 38)
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
