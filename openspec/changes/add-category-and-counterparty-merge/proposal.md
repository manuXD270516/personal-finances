# Propuesta: add-category-and-counterparty-merge

## Why

Con los imports y los datos reales es común terminar con categorías y contrapartes duplicadas: «Super» y «Supermercado», o «HIPERMAXI S.A.» creada en línea al lado de «Hipermaxi». Hoy solo se pueden archivar, y entonces el historial queda partido en dos y las reglas, los planes y los compromisos siguen apuntando al duplicado. FR-CLASSIFICATION-007 y -013 (Could, US-126 y US-127) piden fusionarlas.

D480 (pregunta 16 de docs/76, recomendación aplicada por omisión) las incluye al final de Phase 9 como change 76, para cuando el owner ordene sus categorías reales; D472 fija el orden.

## What Changes

- **Fusionar categorías** (`classification/categories`):
  - Una categoría origen se fusiona en una destino del mismo tipo.
  - Las porciones de transacciones de periodos no cerrados pasan a la destino, sin tocar el ledger.
  - Las referencias de planificación, compromisos, reglas, contrapartes y esenciales del disponible pasan a la destino en la misma operación.
  - La origen queda archivada y marcada «fusionada en» la destino, sin poder desarchivarse.
  - Las subcategorías de la origen pasan a la destino.
  - Antes de confirmar, una vista previa muestra el impacto y los conflictos.
- **Fusionar contrapartes** (`classification/counterparties`):
  - Las transacciones de periodos no cerrados, las suscripciones, los préstamos, las conversiones, los compromisos y las reglas pasan a la destino.
  - Los alias de la origen y su nombre pasan a ser alias de la destino, y la categoría por defecto se resuelve con una regla fija.
  - Tiene la misma vista previa y el mismo bloqueo de desarchivo.
- **Recorrido** (`audit/lifecycle-timeline`): la fusión es una transición de la origen hacia `ARCHIVED` que enlaza la destino, y una anotación en la destino. Revisa D52, que en Phase 1 declaró la máquina sin fusión.
- **Periodos cerrados:** las porciones con fecha en un periodo cerrado conservan la origen y los reportes de esos periodos no cambian. El owner adoptó la recomendación (D494, docs/77).
- **Continuidad de la historia en lo analítico** (D496): FORECAST (series por categoría y gastos atípicos) y RULES (sugerencias de categoría) leen la historia de la origen como historia de la destino con la consulta `CategoryMergeQuery.resolve`; los reportes por periodo y lo ya calculado no cambian.
- **Sin consumidores ni conexiones nuevas** (D249): la fusión corre síncrona en una unidad de trabajo. Cada contexto dueño de una referencia implementa un puerto que define CLASSIFICATION, como `PeriodCreatedHook`. Los eventos `classification.CategoriesMerged.v1` y `classification.CounterpartiesMerged.v1` se publican al outbox sin suscriptores.
- **Fuera de alcance:**
  - Deshacer una fusión.
  - Fusionar tags, grupos de categorías o campos personalizados.
  - Fusionar más de una origen por operación.
  - Fusionar automáticamente o sugerir duplicados.
  - Cambiar los snapshots de cierre o los reportes de periodos cerrados.
  - Unificar la historia de la origen y la destino en los reportes por periodo (D496). Los pronósticos por categoría, los gastos atípicos y las sugerencias de categoría sí la unifican al leer la historia.

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `classification/categories`: 7 ADDED. Fusionar categorías, vista previa, subcategorías, periodos cerrados, referencias en otros contextos, categoría fusionada no desarchivable y continuidad de la historia en los análisis (D496).
- `classification/counterparties`: 4 ADDED. Fusionar contrapartes, vista previa, referencias en otros contextos y contraparte fusionada no desarchivable.
- `audit/lifecycle-timeline`: 1 ADDED. Fusión en el recorrido de categorías y contrapartes.

## Impact

**Specs impactadas:**
- `classification/categories` (7 ADDED), `classification/counterparties` (4 ADDED) y `audit/lifecycle-timeline` (1 ADDED).
- Sin deltas en `planning/budgets`, `planning/budget-templates`, `commitments/recurrence-engine`, `commitments/subscriptions`, `rules/rule-engine`, `debt/loans` ni `transactions/*`: el comportamiento de la fusión sobre sus datos se especifica en los requirements de CLASSIFICATION que la definen (decisión 4 del design). `rules/rule-engine` y `debt/loans` todavía no existen en `openspec/specs/`.

**Componentes/contextos impactados:**
- CLASSIFICATION:
  - Comandos `MergeCategories` y `MergeCounterparties`, consultas de vista previa y DS `CategoryMergePolicy`.
  - Puerto `ClassificationMergeParticipant` y consulta `CategoryMergeQuery.resolve` (contracts), columnas `merged_into_id` y `merged_at`, y el recorrido.
- Participantes (implementan el puerto, sin consumidores):
  - TRANSACTIONS: porciones y contraparte de transacciones en periodos no cerrados, y proveedor de conversiones.
  - PLANNING: líneas de planes no cerrados y versiones de plantillas.
  - COMMITMENTS: definiciones activas y suscripciones.
  - RULES: versión nueva de las reglas afectadas.
  - REPORTING: esenciales del disponible.
  - DEBT: prestamista del préstamo.
  - IMPORTS: filas de importaciones aún no persistidas.
- Lectores de la historia (D496): FORECAST (series por categoría y gastos atípicos) y RULES (sugerencias de categoría) resuelven la origen hacia la destino con `CategoryMergeQuery.resolve`.
- `apps/api`: composición de los participantes. `apps/web`: acción «Fusionar en…» con vista previa en las pantallas de categorías y contrapartes, con i18n es/en/pt.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo):
- Vista previa: `GET …/categories/{categoryId}/merge-preview?targetId=` y `GET …/counterparties/{counterpartyId}/merge-preview?targetId=`.
- Fusión: `POST …/categories/{categoryId}/merge` y `POST …/counterparties/{counterpartyId}/merge`.
- Esquemas nuevos y campos opcionales `mergedInto` en `Category` y `Counterparty`.
- `ErrorCode` suma `CLASSIFICATION_MERGE_CONFLICT`, `CATEGORY_MERGED` y `COUNTERPARTY_MERGED`.

**Tablas impactadas:**
- `classification.category` y `classification.counterparty` (columnas `merged_into_id` y `merged_at`).
- Escrituras por la fusión en `txn.transaction`, `txn.transaction_split`, `txn.conversion_detail`, `planning.budget_line`, `planning.budget_template_version` y `planning.budget_template_line` (versión nueva), `commitments.recurring_definition_version`, `commitments.subscription`, `rules.rule` y sus versiones, `reporting.spendable_essential_category`, `debt.loan` e `imports.staged_transaction`.

**Eventos impactados:** `classification.CategoriesMerged.v1` y `classification.CounterpartiesMerged.v1` (nuevos, publicados al outbox, sin consumidores en este change). Los eventos de las transacciones reasignadas no se emiten uno por uno (decisión 6 del design).

**Migraciones requeridas:** una migración expand con las dos columnas nullable y sus FK compuestas `(merged_into_id, workspace_id)`. Sin datos.

**Test cases:** AÑADIDOS: TC-CLASSIFICATION-MERGE-001..030 (30) y TC-AUDIT-LIFECYCLE-028..029 (2). MODIFICADOS: ninguno. DEPRECADOS: ninguno.

**Impacto de regresión:**
- Archivar y desarchivar sin fusión no cambian (TC-CLASSIFICATION-ARCHIVE-*, -UNARCHIVE-*).
- Los recorridos existentes siguen iguales con la versión nueva de la máquina (TC-AUDIT-LIFECYCLE-015..018).
- Los reportes de periodos cerrados y los snapshots no cambian (TC-PLANNING-SNAPSHOT-*).
- La duración de la fusión crece con el volumen; se mide con 10 000 porciones (tarea 5.3).

**Riesgos introducidos:**
- Una fusión equivocada no se deshace: vista previa obligatoria en la UI y confirmación explícita.
- Historia partida entre la origen (periodos cerrados) y la destino en los reportes por periodo (aceptado por D496; los análisis la unifican).
- Bloqueos de filas durante la fusión de una categoría muy usada: unidad de trabajo única con actualizaciones por conjunto.

**Invariantes afectadas:**
- INV-019: la fusión reasigna de forma idempotente y ninguna porción queda huérfana.
- INV-021: ningún asiento cambia.
- Los periodos cerrados no cambian en silencio: la fusión no toca sus porciones.
