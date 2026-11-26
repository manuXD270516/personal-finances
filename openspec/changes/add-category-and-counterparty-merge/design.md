# Diseño

## Contexto

Change 76 de Phase 9 (docs/03 §7). D480 (pregunta 16 de [docs/76](../../../docs/76-phase-9-and-card-interest-questions.md), recomendación aplicada por omisión en [docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)) lo incluye al final de Phase 9 para cuando el owner ordene sus categorías reales; D472 fija el orden. FR-CLASSIFICATION-007 y -013 son Could (US-126, US-127, FEAT-12.7).

Lo que ya existe:
- `Category` y `Counterparty` se archivan (nunca se borran, INV-019) y tienen recorrido con la máquina `ACTIVE ↔ ARCHIVED`. D52 la declaró **sin fusión** en Phase 1; este change la amplía.
- docs/04 ya prevé `mergedInto?`, `MergeCategories`, `MergeCounterparty` y el DS `CategoryMergeService`; docs/11 cataloga `classification.CategoriesMerged.v1` (sin implementar) y docs/10 la ruta `POST …/counterparties/{id}/merge` (P2).
- Recategorizar o cambiar la contraparte de una transacción con fecha en un periodo cerrado se rechaza con `PERIOD_CLOSED` (`classification/categories`, `transactions/bulk-edit`, `planning/month-closing`).

Referencias a una categoría o contraparte en el código de `main`:

| Contexto | Dato | Referencia |
|---|---|---|
| TRANSACTIONS | `txn.transaction_split.category_id`, `.counterparty_id`; `txn.transaction.counterparty_id`; `txn.conversion_detail.provider_counterparty_id` | categoría, contraparte |
| PLANNING | `planning.budget_line` (`target_kind = CATEGORY`); `planning.budget_template_line` (versiones inmutables) | categoría |
| COMMITMENTS | `commitments.recurring_definition_version.category_id`, `.counterparty_id`; `commitments.subscription.counterparty_id` | categoría, contraparte |
| RULES | condiciones y acciones `SET_CATEGORY`, `SET_COUNTERPARTY` de `rules.rule_version`; `rules.rule_suggestion_decision`, `rules.category_suggestion_outcome` (historia) | categoría, contraparte |
| REPORTING | `reporting.spendable_essential_category` | categoría |
| CLASSIFICATION | `classification.counterparty.default_category_id`; `counterparty_alias` | categoría, contraparte |
| DEBT | `debt.loan.lender_counterparty_id` | contraparte |
| IMPORTS | `imports.staged_transaction` (clasificación propuesta y `suggested_category` de las filas sin persistir) | categoría, contraparte |
| FORECAST | series por categoría (`grouped_category_ids`, componentes); anomalías del change 72 | categoría (historia) |

## Objetivos / No objetivos

**Objetivos**
- Fusionar una categoría o una contraparte en otra con una sola operación atómica, auditada e idempotente, que deje toda referencia viva apuntando a la destino.
- Ver el impacto antes de confirmar.
- Respetar los periodos cerrados, el ledger append-only y D249.

**No objetivos**
- Deshacer una fusión, fusionar varias orígenes a la vez, fusionar tags, grupos o campos personalizados.
- Detectar duplicados o sugerir fusiones.
- Reescribir historia cerrada: snapshots, reportes de periodos cerrados, decisiones de sugerencias, pronósticos y anomalías ya publicados.

## Decisiones

1. **Operación síncrona en una unidad de trabajo, con participantes por puerto (sin consumidores).**
   - CLASSIFICATION define en `@pf/classification/contracts` el puerto `ClassificationMergeParticipant`:
     - `preview(ctx, {kind, sourceId, targetId}) → {counts: {key, count}[], conflicts: MergeConflict[]}`.
     - `apply(ctx, {kind, sourceId, targetId, operationId, today})`.
   - Cada contexto dueño de una referencia lo implementa (inversión de dependencias, como `PeriodCreatedHook` de PLANNING) y `apps/api` los compone.
   - `MergeCategories` y `MergeCounterparties` abren una unidad de trabajo y validan con `CategoryMergePolicy` (puro). Después piden la vista previa de todos los participantes: si hay conflictos, rechazan con `CLASSIFICATION_MERGE_CONFLICT` sin cambios. Si no, llaman a `apply` de cada participante en orden fijo y de a uno (nunca en paralelo sobre el mismo cliente), marcan la origen y publican el evento.
   - *Alternativa descartada:* publicar `CategoriesMerged` y que cada contexto lo consuma. Suma hasta 7 consumidores (D249) y deja una ventana en la que la origen está archivada pero sigue referenciada.
   - `arch:check`: los participantes dependen de `@pf/classification/contracts`, como hoy; CLASSIFICATION no depende de ninguno.

2. **Reglas de validez (`CategoryMergePolicy`, TDD).**
   - Origen y destino distintas (`VALIDATION_FAILED`), del mismo workspace (si no, `RESOURCE_NOT_FOUND`) y del mismo tipo de movimiento (`CATEGORY_KIND_MISMATCH`).
   - La origen no puede ser de sistema (`SYSTEM_CATEGORY_IMMUTABLE`); la destino sí puede serlo.
   - La destino debe estar activa (`CATEGORY_ARCHIVED`), y ni la origen ni la destino pueden estar ya fusionadas (`CATEGORY_MERGED`).
   - La origen puede estar activa o archivada, para limpiar duplicados viejos (D497).
   - **Subcategorías:**
     - Las subcategorías activas de la origen pasan a ser hijas de la destino si la destino es de primer nivel. Un nombre repetido entre hermanas activas rechaza con `CLASSIFICATION_MERGE_CONFLICT` (motivo `SUBCATEGORY_NAME_TAKEN`).
     - Si la destino es una subcategoría y la origen tiene hijas activas: `CATEGORY_DEPTH_EXCEEDED`.
     - Fusionar una subcategoría en su propio padre está permitido.
     - Las subcategorías archivadas de la origen no se mueven.
   - Contrapartes: distintas, del mismo workspace, destino activa (`COUNTERPARTY_ARCHIVED`), ninguna fusionada (`COUNTERPARTY_MERGED`). El tipo de la contraparte puede diferir: la destino conserva el suyo.
   - Roles: EDITOR u OWNER, como archivar (`INSUFFICIENT_ROLE` para VIEWER; D499). `If-Match` con la versión de la origen (`PRECONDITION_FAILED`). Cuota `costly` (10 por minuto).
   - Idempotencia: `Idempotency-Key` como las demás acciones `POST`. Repetir la misma fusión ya aplicada devuelve el resultado guardado; una fusión distinta de una origen ya fusionada se rechaza con `CATEGORY_MERGED`.

3. **Periodos cerrados (D494).**
   - TRANSACTIONS reasigna solo las porciones y transacciones cuya fecha de negocio cae fuera de un periodo `closed`, con el mismo criterio de rango que `PERIOD_CLOSED`. Las de periodos cerrados conservan la origen.
   - Los reportes y snapshots de esos periodos no cambian. La origen se muestra archivada con la marca «fusionada en <destino>».
   - Un periodo reabierto (`reopened`) cuenta como no cerrado.
   - La vista previa informa cuántas porciones quedan en la origen por estar en periodos cerrados.
   - *Alternativas descartadas:* rechazar la fusión si hay porciones en periodos cerrados (la vuelve inútil tras unos cierres); reasignar todas, incluidas las cerradas (cambia los reportes de periodos cerrados respecto de su snapshot).

4. **Qué hace cada participante.** Los requirements de CLASSIFICATION describen el resultado visible. No se agregan deltas a las specs de los demás contextos: `rules/rule-engine` y `debt/loans` todavía no existen en `openspec/specs/`, y un delta en cada una duplicaría la misma regla siete veces.

   | Participante | Categoría | Contraparte | Conflictos |
   |---|---|---|---|
   | TRANSACTIONS | `UPDATE` por conjunto de `transaction_split.category_id` en periodos no cerrados | `transaction.counterparty_id` y `transaction_split.counterparty_id` en periodos no cerrados; `conversion_detail.provider_counterparty_id` (dato descriptivo, todas) | — |
   | PLANNING | Líneas de planes de periodos no cerrados: la línea de la origen pasa a la destino; si el plan ya tiene línea de la destino ⇒ conflicto `BUDGET_LINE_EXISTS` (D495). Plantillas: versión nueva con la línea retargeteada si la vigente la referencia; conflicto igual si ya tiene la destino | — | `BUDGET_LINE_EXISTS`, `TEMPLATE_LINE_EXISTS` |
   | COMMITMENTS | Definiciones activas: categoría actualizada en la versión vigente como anotación (no crea versión, no cambia ocurrencias ni montos) | Ídem con la contraparte; suscripciones activas | — |
   | RULES | Cada regla no archivada cuya condición o acción usa la origen recibe una versión nueva con la destino (`changeReason = MERGE`); una condición que queda duplicada se colapsa | Ídem | — |
   | REPORTING | Esenciales del disponible: la origen se reemplaza por la destino, sin duplicar | — | — |
   | CLASSIFICATION | `counterparty.default_category_id` = origen ⇒ destino | Alias de la origen pasan a la destino; el nombre de la origen se agrega como alias si su forma normalizada no es el nombre ni un alias de la destino; categoría por defecto: la de la destino si tiene, si no la de la origen si está activa (D498) | — |
   | DEBT | — | `loan.lender_counterparty_id` | — |
   | IMPORTS | Filas de importaciones en `AWAITING_MAPPING` o `AWAITING_REVIEW` con la origen en su clasificación o sugerencia ⇒ destino | Ídem | — |

   La historia analítica ya calculada no se toca: decisiones y resultados de sugerencias, corridas de pronóstico publicadas y gastos atípicos ya marcados. Las lecturas nuevas de historia sí resuelven la origen hacia la destino (decisión 9).

5. **Marca en la origen y recorrido.**
   - `classification.category` y `classification.counterparty` suman `merged_into_id uuid NULL` (FK compuesta `(merged_into_id, workspace_id)`) y `merged_at timestamptz NULL`.
   - La origen queda `ARCHIVED` con esas dos columnas. `UNARCHIVE` de una fusionada ⇒ `CATEGORY_MERGED` o `COUNTERPARTY_MERGED`.
   - La API expone `mergedInto: {id, name} | null` en `Category` y `Counterparty`.
   - Máquinas `CATEGORY_LIFECYCLE` y `COUNTERPARTY_LIFECYCLE`, `machineVersion` 2, con la transición `MERGE`. Va de `ACTIVE` a `ARCHIVED`; si la origen ya estaba archivada, de `ARCHIVED` a `ARCHIVED`, como la reconstrucción de D37.
   - La transición enlaza la destino y lleva el `operationId`. La destino recibe una anotación `MERGED_FROM` con la origen y los conteos. Las subcategorías movidas reciben la anotación `MOVED` (cambio de padre).
   - Los recorridos de la versión 1 se leen igual.

6. **Eventos y auditoría.**
   - `classification.CategoriesMerged.v1` `{sourceCategoryId, targetCategoryId, movedSubcategoryIds[], counts, operationId, mergedAt}` y `classification.CounterpartiesMerged.v1` `{sourceCounterpartyId, targetCounterpartyId, movedAliases[], counts, operationId, mergedAt}`, con clave de orden `(target, aggregateVersion)`. Se publican al outbox en la misma unidad de trabajo, sin consumidores en este change.
   - `sourceCategoryIds[]` de docs/11 pasa a `sourceCategoryId`: una origen por operación.
   - Las transacciones reasignadas no emiten un `TransactionUpdated` por fila: un registro de auditoría por contexto participante con el `operationId`, los conteos y, por transacción, una anotación en su recorrido con el cambio de categoría o contraparte y el `operationId` (como la edición masiva).
   - Los read models que dependen de esos eventos: REPORTING lee directo, así que no hay caché que invalidar; la sugerencia de categorías (change 73) calcula a pedido.

7. **Vista previa.**
   - `GET …/merge-preview?targetId=` es de solo lectura y corre los `preview` de todos los participantes en una transacción de lectura.
   - Devuelve la origen, la destino, conteos por tipo de referencia (porciones en periodos no cerrados, porciones que quedan en periodos cerrados, transacciones, líneas de plan, plantillas, definiciones, suscripciones, reglas, contrapartes con categoría por defecto, esenciales, préstamos, conversiones, filas de imports, subcategorías que se mueven, alias que se mueven) y la lista de conflictos.
   - VIEWER la puede leer.
   - La UI la muestra antes de confirmar y deshabilita la confirmación con conflictos.

8. **Volumen.** Actualizaciones por conjunto, sin bucles por fila. Objetivo de diseño (no es un requirement): una categoría con 10 000 porciones se fusiona en menos de 10 s en CI. Se mide en la tarea 5.3; si no se alcanza, se pregunta al owner antes de cambiar el enfoque.

9. **Continuidad de la historia en lo analítico (D496).**
   - `@pf/classification/contracts` suma `CategoryMergeQuery.resolve(workspaceId, categoryIds) → Map<categoryId, categoryId>`: para cada categoría fusionada devuelve la destino vigente, siguiendo la cadena si la destino se fusionó después en otra; las no fusionadas no aparecen. Lectura sin efectos, en la unidad de trabajo del llamador.
   - FORECAST: la preparación de las series por categoría y la historia de la detección de gastos atípicos (change 72) cuentan las porciones de la origen como de la destino, incluidas las que quedaron en periodos cerrados.
   - RULES: las sugerencias de categoría (change 73) cuentan la evidencia de la origen como de la destino y nunca proponen una categoría fusionada.
   - Los reportes por periodo, los snapshots y lo ya calculado no cambian (decisión 4).
   - `arch:check`: FORECAST y RULES dependen de `@pf/classification/contracts`, como hoy.
   - *Alternativa descartada:* que nada la resuelva. La serie de la destino perdería los meses cerrados y el pronóstico empeoraría justo después de ordenar las categorías.

## Contratos

**`contracts/openapi/finance-api.v1.yaml` (aditivo; `oasdiff` limpio, Spectral y Redocly sin errores):**
- `GET /workspaces/{workspaceId}/categories/{categoryId}/merge-preview?targetId=` (`previewCategoryMerge`, VIEWER) ⇒ 200 `CategoryMergePreview`; 400, 404 y las de rol.
- `POST /workspaces/{workspaceId}/categories/{categoryId}/merge` (`mergeCategory`, EDITOR, `If-Match`, `Idempotency-Key`, `x-rate-limit: costly`), cuerpo `{targetCategoryId}`, ⇒ 200 `CategoryMergeResult {source: Category, target: Category, counts, operationId}`.
  - 400 `VALIDATION_FAILED`, 403 `INSUFFICIENT_ROLE`, 404, 409 (`CATEGORY_KIND_MISMATCH`, `SYSTEM_CATEGORY_IMMUTABLE`, `CATEGORY_ARCHIVED`, `CATEGORY_MERGED`, `CATEGORY_DEPTH_EXCEEDED`, `CLASSIFICATION_MERGE_CONFLICT`), 412, 428, 429.
- `GET /workspaces/{workspaceId}/counterparties/{counterpartyId}/merge-preview?targetId=` (`previewCounterpartyMerge`) y `POST …/counterparties/{counterpartyId}/merge` (`mergeCounterparty`), análogos, con `COUNTERPARTY_ARCHIVED` y `COUNTERPARTY_MERGED`.
- Esquemas:
  - `MergeCount {key, count}`; `key` con `x-extensible-enum`: `SPLITS_OPEN`, `SPLITS_CLOSED_KEPT`, `TRANSACTIONS_OPEN`, `TRANSACTIONS_CLOSED_KEPT`, `BUDGET_LINES`, `TEMPLATES`, `RECURRING_DEFINITIONS`, `SUBSCRIPTIONS`, `RULES`, `DEFAULT_CATEGORY_COUNTERPARTIES`, `ESSENTIALS`, `LOANS`, `CONVERSIONS`, `IMPORT_ROWS`, `SUBCATEGORIES_MOVED` y `ALIASES_MOVED`.
  - `MergeConflict {reason (x-extensible-enum: BUDGET_LINE_EXISTS, TEMPLATE_LINE_EXISTS, SUBCATEGORY_NAME_TAKEN), refs: {kind, id, label}[]}`.
  - `CategoryMergePreview` y `CounterpartyMergePreview`: `{source, target, counts: MergeCount[], conflicts: MergeConflict[]}`.
- `Category.mergedInto` y `Counterparty.mergedInto` opcionales (`{id, name}` o null).
- `ErrorCode` suma `CLASSIFICATION_MERGE_CONFLICT` (409, con `details.conflicts`), `CATEGORY_MERGED` (409) y `COUNTERPARTY_MERGED` (409).
- `LifecycleTransition` (o su enum de operación) suma `MERGE` y la anotación `MERGED_FROM`, si el contrato del recorrido los enumera (`x-extensible-enum`).

**Contratos internos (TypeScript):** `@pf/classification/contracts` define `ClassificationMergeParticipant`, `MergeKind = 'CATEGORY' | 'COUNTERPARTY'`, `MergeCount`, `MergeConflict` y `CategoryMergeQuery` (decisión 9). Lo implementan TRANSACTIONS, PLANNING, COMMITMENTS, RULES, REPORTING, DEBT e IMPORTS.

**Eventos (`contracts/events/classification/`):** `CategoriesMerged.v1.schema.json` y `CounterpartiesMerged.v1.schema.json`, con ejemplos; docs/11 y `contracts/events/README.md` actualizados.

**Base de datos (migración expand, timestamp posterior a la última de `main`):**
- `classification.category` y `classification.counterparty`: `merged_into_id uuid NULL` y `merged_at timestamptz NULL`.
  - FK compuesta `(merged_into_id, workspace_id)` a la misma tabla.
  - `CHECK (merged_into_id IS NULL OR merged_into_id <> id)` y `CHECK ((merged_into_id IS NULL) = (merged_at IS NULL))`.
- Sin cambios de RLS: las tablas ya tienen RLS forzada y registro en `platform.workspace_scoped_table`.
- Viajan en el export del workspace como propiedades opcionales, con el orden de import que pone la destino antes que la origen.

**Configuración:** ninguna variable nueva.

## Riesgos / Trade-offs

- [Fusión equivocada sin deshacer] → vista previa obligatoria en la UI, confirmación con el nombre de la destino, auditoría con `operationId`. Deshacer queda como mejora (sería otra fusión inversa más mover las porciones por `operationId`).
- [Historia partida entre periodos cerrados y abiertos] → la origen se muestra «fusionada en»; FORECAST, las anomalías y las sugerencias la resuelven hacia la destino al leer (decisión 9, D496); los reportes por periodo no.
- [Unidad de trabajo larga] → actualizaciones por conjunto; objetivo de 10 s con 10 000 porciones; la cuota `costly` evita repeticiones.
- [Siete participantes en una sola transacción] → orden fijo y de a uno; un test de arquitectura verifica que todos los contextos con una referencia registrada implementan el puerto (la tabla del Contexto como lista cerrada).
- [Reglas con versión nueva] → el dry-run y la cobertura (change 55) leen la versión vigente; las versiones anteriores quedan para la auditoría.

## Plan de migración

Migración expand sin datos. Rollback: sin la UI y los endpoints, las columnas quedan en `NULL`; una fusión ya hecha no se revierte con el rollback del código (las referencias ya apuntan a la destino).

## Cambios a docs compartidos (al implementar)

- **docs/01:** as-built de FR-CLASSIFICATION-007 y -013 (Phase 9).
- **docs/04:** `mergedInto` y los comandos implementados.
- **docs/08:** columnas nuevas.
- **docs/10:** endpoints, esquemas y códigos.
- **docs/11 y `contracts/events/README.md`:** eventos nuevos y `sourceCategoryId` en singular.
- **docs/31 (nota a D52)** y el catálogo de máquinas: `machineVersion` 2 con `MERGE`.
- **docs/17 y la matriz:** TC nuevos. **docs/25:** US-126 y US-127 implementadas. **docs/38:** estado del change.

## Preguntas abiertas

Ninguna. El owner adoptó el 2026-11-25 las seis recomendaciones ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md) § «Respuestas posteriores»), incluida la que bloqueaba el grupo 3:

| Pregunta | Decisión | Efecto en este change |
|---|---|---|
| 1. Porciones en periodos cerrados | D494: (a) solo se reasignan las de periodos no cerrados; las cerradas conservan la origen, marcada «fusionada en» | Decisión 3; el grupo 3 queda desbloqueado. |
| 2. Plan con línea de la origen y de la destino | D495: (a) conflicto `BUDGET_LINE_EXISTS` que bloquea la fusión | Decisión 4. |
| 3. Continuidad de la historia en lo analítico | D496: (a) FORECAST, las anomalías y las sugerencias resuelven la origen hacia la destino al leer; los reportes por periodo no | Decisión 9, requirement «Continuidad de la historia de una categoría fusionada en los análisis» en `classification/categories` (TC-CLASSIFICATION-MERGE-028..030) y tarea 3.9. Va en `classification/categories` y no en `forecast/expense-forecasting` por el criterio de la decisión 4: las specs de FORECAST y de las sugerencias todavía no están en `openspec/specs/`. |
| 4. Origen archivada | D497: (a) se puede fusionar | Decisión 2. |
| 5. Categoría por defecto de la contraparte destino | D498: (a) la de la destino si tiene; si no, la de la origen si está activa | Decisión 4. |
| 6. Rol para fusionar | D499: (a) EDITOR u OWNER | Decisión 2. |
