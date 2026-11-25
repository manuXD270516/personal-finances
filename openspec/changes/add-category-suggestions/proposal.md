# Propuesta: add-category-suggestions

## Why

US-248 pide recibir una sugerencia de categoría con su nivel de confianza y poder aceptarla o corregirla, siempre con las reglas explícitas por delante. El owner eligió el enfoque (D476): sugerencia por historial en TypeScript que reutiliza la `DescriptionKey` de las sugerencias de reglas (D395–D399), corre después de las reglas y nunca se aplica sin confirmación. D477 fija el umbral (precisión top-1 ≥ 85 % en un backtesting temporal de al menos 3 meses y sugerir solo con confianza ≥ 0,70) y D471 agrega FR-CLASSIFICATION-014 a docs/01. Las reglas resuelven lo repetitivo y las sugerencias de reglas proponen reglas nuevas, pero entre una regla y otra queda el trabajo de clasificar a mano lo que el historial ya sabe; el clasificador del servicio Python queda como mejora si este enfoque no alcanza el umbral.

## What Changes

- **Sugerencia por historial:** por contraparte y por clave de descripción normalizada, contando solo lo que el usuario clasificó en los últimos 365 días (misma evidencia que las sugerencias de reglas). Se sugiere con al menos 2 transacciones, confianza ≥ 0.7000 y una categoría ganadora; el nivel es «alta» desde 0.9000 con 5 o más transacciones.
- **Precedencia:** elección del usuario > reglas > categoría por defecto de la contraparte > sugerencia por historial. En el alta manual se avisa cuando una regla clasificará el gasto.
- **Alta manual:** la sugerencia se muestra con su confianza y su motivo mientras la categoría está vacía; la consulta viaja en el cuerpo (`POST`), nunca en la URL. La sugerencia por historial reemplaza a «la última usada» de la contraparte cuando existe (MODIFIED en `classification/counterparties`).
- **Vista previa del import:** sugerencia por fila después de las reglas, aceptación por fila y en lote por nivel, recalculada al reevaluar las reglas. Lo no aceptado se crea sin categoría.
- **Medición:** registro del resultado de cada sugerencia (aceptada, corregida o ignorada) e informe de la tasa de aceptación; backtesting temporal mensual con fila bloqueante en el nightly (precisión ≥ 0.8500 con el Large Seed).
- **Fuera de alcance:** clasificador en el servicio Python (D476, mejora); sugerir etiquetas, contrapartes o splits; automatizaciones (D479); crear reglas desde las sugerencias de categoría (ya lo hacen las sugerencias de reglas).

## Capabilities

### New Capabilities
- `classification/auto-classification`: 13 ADDED. Sugerencia y confianza, historial que cuenta, patrones, precedencia de reglas y usuario, confirmación obligatoria, alta manual, vista previa del import, motivo, tasa de aceptación, backtesting, funcionamiento sin procesos nuevos, permisos y aislamiento, y rendimiento.

### Modified Capabilities
- `classification/counterparties`: 1 MODIFIED. La sugerencia por historial reemplaza a la última categoría usada.

## Impact

**Specs impactadas:** `classification/auto-classification` (nueva, 13 ADDED) y `classification/counterparties` (1 MODIFIED). Lee sin modificar: `rules/rule-engine` (evidencia, `DescriptionKey` y evaluación; change 55 y 62, aún sin archivar) e `imports/import-pipeline` (etapa de clasificación; change 54).

**Componentes/contextos impactados:**
- RULES (dueño de la capability, como `imports/banking-providers` vive en IMPORTS): DS `CategorySuggester` en el dominio (reusa `descriptionKey`), servicio `CategorySuggestionService` (consulta, caché por workspace, registro de resultados, informe y backtesting) y query `CategorySuggestionQuery` y puerto `CategorySuggestionFeedbackPort` en `@pf/rules/contracts`.
- IMPORTS: la etapa de clasificación llama a `CategorySuggestionQuery` después de las reglas, guarda la sugerencia en la fila, agrega la aceptación en lote y, al aprobar, registra los resultados por el puerto.
- `apps/web`: formulario de alta, vista previa del import y la tarjeta de la tasa en la vista de reglas, con i18n es/en/pt.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo):
- Endpoints nuevos: `POST /workspaces/{workspaceId}/category-suggestions/query`, `POST …/category-suggestions/feedback`, `GET …/category-suggestions/stats` y `POST /workspaces/{workspaceId}/imports/{importId}/rows/accept-suggestions`.
- `ImportPreviewRow.suggestedCategory` (opcional, nullable) e `ImportRowDecisionRequest.acceptedSuggestion` (opcional).
- Sin códigos de error nuevos.

**Tablas impactadas:** `rules.category_suggestion_outcome` (nueva, RLS forzada, registrada en `platform.workspace_scoped_table`). La fila de staging del import suma una columna nullable `suggested_category jsonb`.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** una migración expand: tabla nueva y columna nullable.

**Test cases:** AÑADIDOS: TC-CLASSIFICATION-AUTO-001..026 (26). MODIFICADOS: ninguno; TC-CLASSIFICATION-SUGGESTION-001 sigue igual porque su scenario no cambia. DEPRECADOS: ninguno.

**Impacto de regresión:** la etapa de clasificación del import suma un cálculo en memoria (TC-CLASSIFICATION-AUTO-026 frente a NFR-PERF-007); el resto de la vista previa y la cobertura de reglas no cambian (TC-RULES-ENGINE-* y TC-IMPORTS-PIPELINE-* en verde); `rules/coverage` sigue contando solo el origen `RULE`.

**Riesgos introducidos:** RISK-015 (confianza indebida: confirmación siempre explícita, nivel y motivo visibles), refuerzo de errores (lo aceptado cuenta como elección del usuario: la tasa de aceptación y el backtesting lo vigilan), RISK-010 (privacidad: descripciones en el cuerpo, resultados sin descripciones ni montos).

**Invariantes afectadas:** ninguna del ledger. La confianza y la tasa usan Decimal con HALF_EVEN; no se modifica ninguna transacción sin acción del usuario.
