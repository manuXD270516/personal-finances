# Diseño

## Contexto

Change 73 de Phase 9 (docs/03 §7, D472). RULES ya tiene lo necesario (changes 55 y 62, implementados y sin archivar):
- La evidencia de clasificación manual: `ClassificationSubjectsQuery.listEvidence` de TRANSACTIONS, con origen `MANUAL` o desconocido con `source` `MANUAL`/`IMPORT`, un solo split, sin `managedBy`.
- La clave canónica `descriptionKey` en el dominio de RULES.
- La evaluación de reglas (`RuleEvaluationQuery`), con los disparadores `IMPORT` y `MANUAL_CREATE`.

IMPORTS evalúa las reglas en su etapa de clasificación, dentro del procesamiento existente. CLASSIFICATION ya sugiere la categoría por defecto de una contraparte o la última usada (FR-CLASSIFICATION-011).

Decisiones del owner ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)): D476 (historial en TypeScript, `DescriptionKey`, después de las reglas, nunca sin confirmación), D477 (≥ 85 % top-1 en backtesting temporal de ≥ 3 meses; sugerir con confianza ≥ 0,70), D471 (FR-CLASSIFICATION-014), D249 (sin consumidores ni conexiones nuevas).

## Objetivos / No objetivos

**Objetivos**
- Sugerir la categoría con confianza y motivo en el alta manual y en la vista previa del import, después de las reglas.
- Medir la precisión (backtesting) y la tasa de aceptación (uso real).

**No objetivos**
- Clasificador entrenado en el servicio Python (mejora si no se alcanza D477).
- Sugerir etiquetas, contrapartes, splits o descripciones.
- Aplicar sugerencias sin una acción del usuario o reclasificar la historia.

## Decisiones

1. **Contexto dueño: RULES; capability: `classification/auto-classification`.** RULES ya lee la evidencia y tiene la `DescriptionKey`; IMPORTS ya depende de `@pf/rules/contracts`. Ponerlo en CLASSIFICATION obligaría a que CLASSIFICATION lea TRANSACTIONS (ciclo: TRANSACTIONS lee CLASSIFICATION). La capability sigue la taxonomía de docs/24 §5.9 aunque la implemente RULES, como `imports/banking-providers`.

2. **Evidencia.** La misma de las sugerencias de reglas (D395), en una ventana de `RULES_CATEGORY_SUGGEST_WINDOW_DAYS` (365) y hasta `RULES_CATEGORY_SUGGEST_MAX_EVIDENCE` (5000) transacciones, las más recientes; `truncated` se registra en la métrica. Solo cuenta lo que fijó el usuario: lo que pusieron las reglas ya lo cubren las reglas, y contarlo haría que una regla desactivada siguiera clasificando por la puerta de atrás. Una sugerencia aceptada queda con origen `MANUAL` y desde ahí cuenta como evidencia, porque el usuario la confirmó. *Alternativa descartada:* un origen nuevo `SUGGESTION` en TRANSACTIONS. Cambiaría el CHECK de `category_origin`, la cobertura de reglas y la evidencia de D395, y el resultado ya se registra aparte (decisión 7).

3. **Algoritmo (`CategorySuggester`, dominio puro, TDD).**
   - Para un sujeto `{kind, description, counterpartyId}` se arman dos patrones: la contraparte, si la hay, y `descriptionKey(description)`, si no es nula. Cada uno cuenta, sobre la evidencia del mismo `kind`, las transacciones por categoría activa compatible con el tipo.
   - `support` = el total del patrón; `matches` = las de la categoría más frecuente; `confidence` = `matches / support` con 4 decimales HALF_EVEN.
   - Válido si `support ≥ RULES_CATEGORY_SUGGEST_MIN_SUPPORT` (2), `confidence ≥ RULES_CATEGORY_SUGGEST_MIN_CONFIDENCE` (0.7000, D477) y la categoría gana estricto.
   - Combinación: si los dos patrones coinciden en la categoría, se devuelve una sola sugerencia con `basis = BOTH` y la confianza mayor. Si difieren, gana la de mayor confianza, y a igual confianza la de la contraparte, que es una señal más precisa que el texto.
   - Nivel `HIGH` con `confidence ≥ 0.9000` y `support ≥ 5`; si no, `MEDIUM`.
   - El mínimo de 2 (y no 3, como las reglas, D396) se debe a que una sugerencia se confirma una por una: el costo de un error es un clic, y con un solo caso no se sugiere.
   - El monto, la cuenta y el día (docs/15 §12) quedan para el clasificador del servicio.

4. **Precedencia.**
   - En el import, la etapa ya resuelve, en este orden: lo editado por el usuario, la regla y la categoría por defecto de la contraparte (origen `DEFAULT`). La sugerencia se calcula solo para las filas de ingreso, gasto o reembolso que siguen sin categoría.
   - En el alta manual, la consulta evalúa primero las reglas activas con el disparador `MANUAL_CREATE` sobre el borrador, con `RuleEvaluator` en modo `FILL_EMPTY`. Si alguna fija la categoría, responde `RULE_APPLIES` con la regla. La web solo consulta mientras la categoría está vacía y, si la contraparte tiene categoría por defecto, muestra esa (FR-CLASSIFICATION-011).
   - La sugerencia por historial reemplaza a «la última usada» de la contraparte cuando existe (MODIFIED): es la misma señal con confianza, y mostrar las dos confundiría.

5. **Consulta del alta manual.** `POST …/category-suggestions/query`, porque la descripción es un dato personal y no debe quedar en URLs ni en logs de acceso. Hay una caché en proceso por workspace del índice de evidencia (patrón → conteos por categoría), con TTL `RULES_CATEGORY_SUGGEST_CACHE_TTL_SECONDS` (300) y tope de 200 workspaces (LRU). Una aceptación no invalida la caché: la sugerencia siguiente puede tardar hasta 5 minutos en reflejarla, y es aceptable. La web llama con *debounce* (400 ms) al cambiar la descripción o la contraparte. *Alternativa descartada:* una tabla de estadísticas mantenida por un consumidor de `TransactionCreated`, que suma un consumidor (D249). Otra alternativa descartada: una columna `description_key` en TRANSACTIONS, que obliga a migrar y a mantener la clave canónica en dos contextos.

6. **Vista previa del import.**
   - Después de evaluar las reglas, la etapa construye el índice una vez por importación y guarda en cada fila elegible `suggested_category` (`{categoryId, confidence, level, support, matches, basis, descriptionKey, counterpartyId}`).
   - `reevaluate-rules` recalcula las sugerencias de las filas cuya categoría no editó el usuario.
   - `POST …/rows/accept-suggestions {minLevel: HIGH|MEDIUM, rowIds?}` con `If-Match` aplica la categoría sugerida a cada fila elegible, con origen `MANUAL`, en una sola edición de la importación (una versión nueva). Una fila sin sugerencia o ya editada no cambia.
   - Aceptar una sola fila usa el endpoint existente `decideImportRow` con la categoría sugerida y la marca `acceptedSuggestion: true`, opcional y aditiva.
   - Si falla el cálculo, la fila queda sin sugerencia, se registra en la métrica y la vista previa sigue, igual que `IMPORT_RULES_UNAVAILABLE` (sin código nuevo: es solo una ausencia).

7. **Tasa de aceptación.** Tabla `rules.category_suggestion_outcome`: `workspace_id`, `surface` (`MANUAL_ENTRY`/`IMPORT`), `level`, `outcome` (`ACCEPTED`/`CORRECTED`/`IGNORED`), `occurred_on` (fecha en la zona del workspace), `import_job_id` nulo y `transaction_id` nulo. No guarda descripciones, montos ni categorías: la tasa no las necesita.
   - En el import, al aprobar, IMPORTS llama a `CategorySuggestionFeedbackPort.recordBatch` en la misma unidad de trabajo, con el resultado de cada fila que tenía sugerencia: aceptada si la categoría final es la sugerida con la marca de aceptación, corregida si es otra e ignorada si queda sin categoría.
   - En el alta manual, la web llama a `POST …/category-suggestions/feedback` después de guardar. Si esa llamada se pierde, se pierde un dato de la métrica, nunca uno financiero.
   - `GET …/category-suggestions/stats?from&to` agrega por canal y nivel.

8. **Backtesting (D477).** `pnpm rules:category-suggestions:backtest -- --workspace <id> --months <n ≥ 3> [--as-of YYYY-MM]` (runner de `interface`, sin efectos). Para cada mes M de la ventana:
   - Construye el índice con la evidencia hasta el fin de M − 1, con los mismos límites de ventana y máximo que en producción.
   - Sugiere para cada transacción elegible como evidencia del mes M (lo que el usuario clasificó).
   - Cuenta como acierto que la categoría sugerida sea la vigente.
   Informa por mes y en total `precision = aciertos / sugerencias` y `coverage = sugerencias / transacciones` (4 decimales HALF_EVEN), por nivel y por base, sin descripciones ni montos. El nightly agrega una fila bloqueante con el Large Seed: los últimos 3 meses de su ventana y `precision ≥ 0.8500`. Las reglas no participan en el backtesting: mide al sugeridor solo, que es lo que D477 umbraliza.

9. **Habilitación y procesos.** `RULES_CATEGORY_SUGGEST_ENABLED` (por omisión `true`). Sin trabajos ni consumidores: la consulta es síncrona en la API y la etapa del import corre en el procesamiento existente (D249). No depende de FORECAST ni del servicio de pronósticos.

10. **Permisos y privacidad.**
    - Consulta y estadísticas: VIEWER o más (leer el historial ya está permitido).
    - Registro de resultados del alta manual y aceptación en el import: EDITOR o más.
    - La evidencia se lee en la unidad de trabajo de la petición, con RLS. La caché se indexa por workspace y nunca mezcla workspaces.
    - El registro de resultados no se audita (es telemetría de producto sin efecto en los datos). La aceptación en lote del import sí, como toda edición de la vista previa.
    - El texto del motivo muestra la clave normalizada, no la descripción original.

11. **UI.**
    - Formulario de alta: un chip «Sugerida: Restaurantes · alta» con el motivo («Elegiste Restaurantes en 9 de 10 gastos parecidos a "pedidosya"») y los botones Aceptar y Otra.
    - Vista previa del import: una columna de sugerencia con acción por fila, «Aceptar sugerencias de confianza alta» en la barra (y la variante con media) y un filtro «con sugerencia».
    - Vista de reglas: una tarjeta con la tasa de aceptación del mes.
    - Todo con i18n es/en/pt.

## Contratos

**`contracts/openapi/finance-api.v1.yaml` (aditivo; oasdiff limpio, Spectral y Redocly sin errores):**

- `POST /workspaces/{workspaceId}/category-suggestions/query` (`queryCategorySuggestion`, tag `Rules`, `x-openspec-capability: [classification/auto-classification]`, `x-required-role: VIEWER`; lectura, sin `Idempotency-Key`). Cuerpo `CategorySuggestionQueryInput {kind: INCOME|EXPENSE|REFUND, description?: string (≤ 500), counterpartyId?: Uuid, accountId?: Uuid, date?: date}` con al menos uno de `description` o `counterpartyId` (`VALIDATION_FAILED` si no). Respuesta 200 `CategorySuggestionResult {status: SUGGESTED|RULE_APPLIES|NONE|DISABLED, suggestion: CategorySuggestion|null, ruleId: Uuid|null}`. Errores: 400, 401, 403, 404 (workspace), 422 `VALIDATION_FAILED`, 429 y 500.
- `POST /workspaces/{workspaceId}/category-suggestions/feedback` (`recordCategorySuggestionOutcome`, `x-required-role: EDITOR`, `Idempotency-Key`). Cuerpo `CategorySuggestionFeedbackInput {surface: MANUAL_ENTRY, level: HIGH|MEDIUM, suggestedCategoryId: Uuid, chosenCategoryId: Uuid|null, transactionId?: Uuid}`. Respuesta 204. Errores: 400, 403, 422 `VALIDATION_FAILED` / `IDEMPOTENCY_KEY_REUSED` y 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`.
- `GET /workspaces/{workspaceId}/category-suggestions/stats?from&to` (`getCategorySuggestionStats`, `x-required-role: VIEWER`). Respuesta `CategorySuggestionStats {from, to, shown, accepted, corrected, ignored, acceptanceRate: string|null (4 decimales; null sin sugerencias), bySurface: [{surface, shown, accepted, corrected, ignored}], byLevel: [{level, shown, accepted, corrected, ignored}]}`. Error 400 `INVALID_FILTER` con un rango invertido o de más de 366 días.
- `POST /workspaces/{workspaceId}/imports/{importId}/rows/accept-suggestions` (`acceptImportCategorySuggestions`, `x-required-role: EDITOR`, `If-Match`, `x-openspec-capability: [classification/auto-classification]`). Cuerpo `ImportSuggestionAcceptInput {minLevel: HIGH|MEDIUM, rowIds?: ImportRowId[] (≤ 5000)}`. Respuesta 200 `ImportSuggestionAcceptResult {accepted: integer, version: integer}`. Errores: 409 (importación fuera de `AWAITING_REVIEW`, con el código existente de estado), 412 `PRECONDITION_FAILED`, 428 `PRECONDITION_REQUIRED`, 403 y 404.
- Esquema `CategorySuggestion {categoryId: Uuid, confidence: string ('^\d\.\d{4}$'), level: HIGH|MEDIUM, support: integer, matches: integer, basis: COUNTERPARTY|DESCRIPTION|BOTH, descriptionKey: string|null, counterpartyId: Uuid|null}`.
- `ImportPreviewRow.suggestedCategory: CategorySuggestion|null` (opcional). `ImportRowDecisionRequest.acceptedSuggestion?: boolean` (opcional).
- Sin códigos de error nuevos en `ErrorCode`.

**Contratos internos (TypeScript, aditivos):**
- `@pf/rules/contracts`: `CategorySuggestionQuery.suggestMany({workspaceId, subjects: {ref, kind, description, counterpartyId}[]}) → Map<ref, CategorySuggestionDto>` para IMPORTS (índice construido una vez por llamada) y `CATEGORY_SUGGESTION_QUERY`.
- `@pf/rules/contracts`: `CategorySuggestionFeedbackPort.recordBatch({workspaceId, surface, importJobId, outcomes: {level, outcome, occurredOn, transactionId}[]})` y `CATEGORY_SUGGESTION_FEEDBACK_PORT`.
- Sin cambios en `@pf/transactions/contracts`: se reusa `listEvidence`.

**Eventos:** ninguno.

**Base de datos (migración expand, timestamp posterior a la última de `main`):**
- `rules.category_suggestion_outcome`: `id uuid pk`, `workspace_id`, `surface text check (MANUAL_ENTRY|IMPORT)`, `level text check (HIGH|MEDIUM)`, `outcome text check (ACCEPTED|CORRECTED|IGNORED)`, `occurred_on date`, `import_job_id uuid null`, `transaction_id uuid null` y `created_at`. Índice `(workspace_id, occurred_on)`. RLS forzada (D298), registrada en `platform.workspace_scoped_table` y fuera del export (es telemetría).
- Staging de filas del import: `suggested_category jsonb null` y `suggestion_accepted boolean not null default false`. Es expand: la columna nueva es nullable y el default es constante.

**Configuración (API y worker donde corre la etapa del import; `docs/config-reference.md`):**

| Variable | Omisión |
|---|---|
| `RULES_CATEGORY_SUGGEST_ENABLED` | `true` |
| `RULES_CATEGORY_SUGGEST_WINDOW_DAYS` | `365` |
| `RULES_CATEGORY_SUGGEST_MAX_EVIDENCE` | `5000` |
| `RULES_CATEGORY_SUGGEST_MIN_SUPPORT` | `2` |
| `RULES_CATEGORY_SUGGEST_MIN_CONFIDENCE` | `0.7000` |
| `RULES_CATEGORY_SUGGEST_CACHE_TTL_SECONDS` | `300` |

## Riesgos / Trade-offs

- [Refuerzo de una clasificación equivocada aceptada en lote] → la aceptación en lote es por nivel y explícita; la tasa de corrección por nivel y el backtesting lo muestran; si el nivel «media» corrige mucho, se ofrece solo «alta».
- [Evidencia truncada a 5000 en workspaces grandes] → son las más recientes, que son las que más predicen; el backtesting usa los mismos límites.
- [Caché en proceso con varias réplicas de la API] → en N1 hay una; con varias, cada una tiene su caché y la diferencia es de minutos; no afecta datos.
- [El Large Seed no refleja cómo clasifica una persona] → la fila del nightly mide el algoritmo con el seed y el criterio de salida se confirma con los datos del owner (D477); si el seed no alcanza 0.8500 por cómo genera las categorías, se registra en la tarea 5.3 y se consulta al owner antes de bajar el umbral.
- [Doble sugerencia con la de la contraparte] → reemplazo explícito (MODIFIED), un solo chip.

## Plan de migración

Migración expand. Deploy sin pasos manuales. Rollback: `RULES_CATEGORY_SUGGEST_ENABLED=false`; la columna y la tabla quedan sin uso.

## Cambios a docs compartidos (al implementar)

- **docs/01:** as-built de FR-CLASSIFICATION-014 y nota en FR-CLASSIFICATION-011.
- **docs/05 y docs/06:** RULES expone `CategorySuggestionQuery` y `CategorySuggestionFeedbackPort`; IMPORTS los usa.
- **docs/10:** endpoints nuevos. **docs/13 §4:** etapa de clasificación con la sugerencia. **docs/15 §12:** as-built del enfoque por historial.
- **docs/17 y la matriz:** TC nuevos. **docs/23 y el nightly:** fila del backtesting.
- **docs/25:** US-248 implementada. **docs/38:** estado del change.
- **docs/config-reference.md:** las seis variables.
- **ARCHITECTURE §14:** nota de que `classification/auto-classification` la implementa RULES.

## Preguntas abiertas

Ninguna bloqueante. D476 y D477 fijan el enfoque y el umbral. Los parámetros no decididos por el owner (apoyo mínimo 2, nivel «alta» desde 0.9000 con 5, ventana de 365 días, reemplazo de «la última usada») son decisiones de diseño configurables o reversibles y se revisan con la tasa de aceptación al cerrar el criterio de salida.
