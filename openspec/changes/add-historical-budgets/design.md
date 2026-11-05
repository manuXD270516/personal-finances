# Diseño: add-historical-budgets

## Contexto

- **Alcance de Phase 7** (docs/24 §5.7): "average/historical-based budgets". FR-PLANNING-021 (Could) define `average-based` como el "promedio de últimos N periodos cerrados" y `historical-based` como el "igual periodo del año anterior ± ajuste %". US-231 (docs/25, FEAT-21.4) es Could.
- **Estado del plan mensual** (`planning/budgets`, `planning/budget-templates`, archivados):
  - Líneas por categoría, grupo o tag de tipos `FIXED`, `MAXIMUM`, `MINIMUM`, `RANGE` y `PERCENT_OF_INCOME`, con rollover, umbrales y `source` `MANUAL | TEMPLATE | CLONE`. Una línea de template editada queda `overridden`.
  - El real de cada línea lo calcula `BudgetCalculator.view`: `NominalFlowQuery.summarizeNominalFlows` sobre el rango del periodo, valorado en la moneda del plan con `FlowValuation`, tasa del tipo preferido al cierre del día y ventana de Reporting (D109). Sin tasa, la parte queda sin convertir y el resultado es incompleto, nunca 1:1.
  - La propagación a futuro usa el patrón **vista previa sin estado + confirmación con token** (`BUDGET_PROPAGATION_STALE`). Este change lo repite.
- **Periodos** (`planning/financial-periods`): mensuales según el día de inicio configurado, creados retroactivamente desde la primera actividad (`LedgerActivityRangeQuery.getActivityRange().minEntryDate`) y con anticipación. El calendario (`PeriodCalendar`) sabe calcular el rango de cualquier periodo, exista o no la fila.
- **Restricciones:**
  - sin consumidores nuevos (D249: 64 de 67 conexiones útiles);
  - dinero con `Decimal` y HALF_EVEN;
  - contratos aditivos;
  - el owner todavía no cerró ningún mes real (docs/38 §2, `add-month-closing` 7.4): con "solo periodos cerrados" literal, la función no tendría datos hoy (pregunta 2).

## Objetivos / No objetivos

**Objetivos**

- Sugerir el monto de cada línea del plan desde la historia real, con un método explicable y determinista (misma entrada ⇒ mismo resultado).
- Excluir lo que distorsiona: periodos incompletos, montos sin tasa y valores atípicos. El usuario puede excluir o reincluir a mano.
- Aplicar solo lo que el EDITOR confirma, con trazabilidad de la base de cada monto.
- Reutilizar el cálculo del real del presupuesto, sin una segunda definición de "gasto".

**No objetivos**

- Tipos de línea que se recalculen solos en cada periodo (pregunta 1).
- Sugerencias sobre templates, "guardar como template" y aplicación masiva a varios periodos.
- Pronóstico, tendencia o estacionalidad (Phase 8, `forecast/expense-forecasting`).
- Detección de transacciones atípicas (FR-FORECAST-010).
- Notificaciones ("tu presupuesto quedó viejo").
- Mediana o percentiles como método (la mediana solo se informa).

## Decisiones

### 1. Sugerencia que fija un monto, no un tipo de línea nuevo

- **Elegida:** "promedio" y "año anterior" son **métodos de sugerencia**. El resultado se escribe, tras la confirmación, como el monto de referencia de una línea de tipo existente (planificado de `FIXED`, `MAXIMUM` e ingreso; mínimo de `MINIMUM`; máximo de `RANGE`). La línea guarda la base en `history_basis`.
- **Alternativa (a): tipos `AVERAGE_BASED` y `HISTORICAL_BASED`** con el monto recalculado al leer o al crear el periodo, lectura literal de FR-PLANNING-021. Se descarta:
  - el planificado cambiaría solo cuando cambia la historia (una anulación de agosto movería el presupuesto de noviembre), lo que choca con "no automática" del pedido y con la idea de un plan que el usuario aprueba;
  - los umbrales ya emitidos "una sola vez por umbral y periodo" (FR-PLANNING-022) se volverían ambiguos;
  - cada lectura del progreso multiplicaría el costo por N periodos.
- **Alternativa (b): sugerencia solo en la UI**, sin guardar la base. Se descarta: pierde la trazabilidad del monto y la portabilidad.
- docs/01 FR-PLANNING-021 recibe una nota as-built (Cambios a docs compartidos). Es la pregunta 1 [B].

### 2. Ventana: últimos N periodos terminados, según el calendario de periodos

- La ventana son los N periodos inmediatamente anteriores al periodo objetivo cuyo fin es anterior a hoy (zona del workspace) y al inicio del objetivo. Se calcula con `PeriodCalendar`, así que respeta el día de inicio y sus cambios hacia adelante.
- Un periodo de la ventana que no existe como fila (anterior a la creación retroactiva) se informa como `BEFORE_FIRST_ACTIVITY`.
- **Terminados y no solo cerrados** (recomendación de la pregunta 2): cada periodo informa si está cerrado. La UI marca "datos no congelados" para los abiertos.
- **Ventana fija:** si se excluyen periodos, la ventana no se extiende hacia atrás. Así la explicación ("últimos 6 periodos") es estable y no mezcla temporadas lejanas.
- N entre 1 y 12; 6 por omisión (`PLANNING_HISTORY_DEFAULT_PERIODS`). Con 6 hay valores suficientes para que las vallas de Tukey actúen (decisión 4).

### 3. Real por periodo: el mismo cálculo del progreso

- `HistoricalActualsLoader` (application) hace **una** llamada a `summarizeNominalFlows` sobre el rango completo de la ventana (más el periodo del año anterior si se pide), con `withTags` si hay líneas de tag. Resuelve las tasas en **un** lote con `FlowValuation.resolveRates`, con la misma selección que `BudgetCalculator`.
- Asigna cada flujo a su periodo por fecha de negocio y consolida por línea con `categoriesOfTarget` (categoría con subcategorías, grupo o tag). Se extrae de `BudgetCalculator` una función compartida, `lineActual`, para no duplicar la regla (tarea 3.1).
- Valoración incompleta de una línea en un periodo ⇒ estado `NO_RATE` para esa línea y ese periodo. Las demás líneas del periodo no se afectan.
- Periodo con fecha de inicio anterior a `minEntryDate` y fin posterior o igual ⇒ `INCOMPLETE`; fin anterior ⇒ `BEFORE_FIRST_ACTIVITY`.
- Sin actividad ⇒ todos los periodos `BEFORE_FIRST_ACTIVITY`.

### 4. Atípicos: vallas de Tukey con cuartiles por medianas de las mitades

| Opción | Cómo funciona | Pros | Contras |
|---|---|---|---|
| **(a) Tukey 1.5 × RIC con n ≥ 4 (elegida)** | Cuartiles por medianas de las mitades (n impar: la mediana no entra en ninguna mitad); fuera de [Q1 − 1.5 RIC, Q3 + 1.5 RIC] ⇒ atípico | Estándar, explicable ("más de 1.5 veces el rango intercuartil"), exacto con `Decimal`, simétrico (también excluye meses anormalmente bajos) | Con n < 4 no actúa |
| (b) Mediana ± k × MAD | Desvío absoluto mediano | Robusta | MAD = 0 con dos valores iguales excluye todo lo distinto; poco explicable |
| (c) Media recortada (quitar máx. y mín.) | Siempre quita 2 valores | Simple | Descarta datos buenos; con n = 3 queda 1 valor |
| (d) Factor sobre la mediana (> 2 × mediana) | Solo picos altos | Muy simple | Falla con mediana 0; asimétrica |

- Método de cuartiles fijado en la spec para que el resultado sea reproducible en cualquier implementación. La propiedad "permutar los periodos no cambia el resultado" se prueba con PBT (TC-PLANNING-HISTBUDGET-031).
- Mínimo de valores válidos: ⌈N / 2⌉, al menos 1 (`INSUFFICIENT_HISTORY` si faltan). Es configurable en `PLANNING_HISTORY_MIN_VALID_RATIO`.

### 5. Promedio, ajuste y redondeo

- `promedio = Σ usados ÷ cantidad`, con `Decimal` a precisión completa. `× (1 + ajuste/100)` si hay ajuste (escala 2, rango [−100.00, 1000.00]).
- Luego, HALF_EVEN a la escala de la moneda del plan. Con incremento (1, 5, 10, 50, 100), HALF_EVEN al múltiplo: `round(x / inc) × inc`.
- El orden de las operaciones queda fijo y explicado: promedio → ajuste → escala → múltiplo.
- La mediana de los usados se informa, no se usa.
- El monto de un ingreso esperado sigue la misma fórmula sobre el real de ingresos de la categoría.

### 6. Vista previa sin estado y confirmación con token

Igual que la propagación (`budget-propagations`):

- `preview` calcula y devuelve líneas, explicación y un `token`. El token es el SHA-256 de: periodo, `budgetId` y versión del plan (o `null`), parámetros, ajustes manuales por línea, y por cada línea el objetivo con su monto sugerido y su estado.
- `confirm` recibe el token, los parámetros y las líneas elegidas (`target`, `nature`, `kind` para líneas nuevas, `amount` final y `suggestedAmount` visto). En **una** unidad de trabajo:
  1. bloquea el plan (o el periodo si no hay plan);
  2. recalcula solo las líneas elegidas y compara: si una sugerencia o la versión del plan difieren ⇒ `BUDGET_SUGGESTION_STALE` (409) sin cambios;
  3. crea el plan (origen `EMPTY`) si no existe;
  4. crea o actualiza las líneas con las validaciones existentes (`BUDGET_INVALID_AMOUNTS`, `AMOUNT_SCALE_EXCEEDED`, `BUDGET_TARGET_OVERLAP`, `CATEGORY_ARCHIVED`…);
  5. guarda `history_basis` y audita cada línea con un `operationId` común;
  6. reevalúa los umbrales con el mecanismo vigente.
- Un monto escrito por el EDITOR distinto del sugerido se acepta (es su decisión) y queda en la base como `applied` frente a `suggested`.
- **Alternativa descartada: borrador persistido** (`planning.budget_suggestion_draft`). Agrega tabla, ciclo de vida y limpieza para un flujo de una sola pantalla. Se reconsidera si el owner quiere volver a un borrador días después (pregunta 4).

### 7. Líneas alcanzadas

- Con plan: todas sus líneas. `PERCENT_OF_INCOME` ⇒ `NOT_APPLICABLE` (su monto se deriva).
- Sin plan (descubrimiento): categorías raíz de gasto y de ingreso no archivadas con sugerencia > 0.00, con tipo propuesto `MAXIMUM` para gasto y ingreso esperado `FIXED` para ingreso, umbrales por defecto. No se proponen grupos ni tags (no hay forma neutral de elegirlos). El EDITOR puede agregar a la vista previa un objetivo cualquiera (`extraTargets`), validado contra solapamientos.
- El rollover no cambia: se suma sobre el monto aplicado como hoy.

### 8. La base histórica en la línea

`planning.budget_line.history_basis jsonb NULL`, validada por el dominio (`HistoryBasis`, `schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "method": "AVERAGE",
  "periodsRequested": 6,
  "adjustmentPercent": "0.00",
  "roundingIncrement": null,
  "suggested": { "amount": "1480.00", "currency": "BOB" },
  "applied": { "amount": "1480.00", "currency": "BOB" },
  "mean": "1480.00",
  "median": "1474.50",
  "usedCount": 5,
  "periods": [
    { "periodId": "…", "label": "2026-08", "start": "2026-08-01", "end": "2026-08-31", "closed": false, "actual": "3950.00", "status": "OUTLIER" }
  ],
  "computedAt": "2026-11-04T14:00:00Z",
  "operationId": "…"
}
```

- Montos como texto decimal, nunca `number`.
- Una edición manual posterior no borra la base. La vista calcula `modifiedAfterSuggestion = (monto vigente ≠ applied)`.
- `BudgetCloner` y la propagación **no** copian la base (decisión del requirement "Sin aplicación automática").

### Capas afectadas

| Contexto | Capa | Cambio |
|---|---|---|
| Planning | domain | DS `HistoricalBudgetEstimator` (puro); VO `HistoryBasis`, `SuggestionWindow`; `BudgetLine` acepta y conserva `historyBasis` |
| Planning | application | `BudgetSuggestionService.preview` / `.confirm`; `HistoricalActualsLoader`; función `lineActual` extraída de `BudgetCalculator`; `BudgetsDeps` gana `activity: LedgerActivityRangeQuery` (ya existe en `PlanningDeps`) |
| Planning | infrastructure | `PgBudgetRepository` lee y escribe `history_basis`; sección del export |
| Planning | interface | Controller `budget-suggestions` |
| `apps/api` | composición y perf | Rutas, OpenAPI, benchmark `budget-suggestions.perf.ts` |
| `apps/web` | UI | Botón "Sugerir desde el historial" en el plan; tabla con selección, monto editable, método, N, ajuste, redondeo y explicación desplegable; indicador en la línea "sugerido desde el historial" |

## Contratos

### OpenAPI (aditivo, tag Planning, `x-openspec-capability: planning/budgets`)

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `previewBudgetSuggestions` | `POST W/budget-suggestions/preview` | VIEWER | Sin efectos ni auditoría. Cuerpo `BudgetSuggestionRequest`; respuesta `BudgetSuggestionPreview`. 404 `REFERENCE_NOT_FOUND` (periodo); 422 `VALIDATION_FAILED` |
| `confirmBudgetSuggestions` | `POST W/budget-suggestions/confirm` | EDITOR | `Idempotency-Key`. Cuerpo `BudgetSuggestionConfirm`; respuesta `Budget` (con `historyBasis` en las líneas aplicadas). 409 `BUDGET_SUGGESTION_STALE`, `PERIOD_CLOSED`, `CATEGORY_ARCHIVED` / `TAG_ARCHIVED`; 422 `BUDGET_INVALID_AMOUNTS`, `AMOUNT_SCALE_EXCEEDED`, `CURRENCY_MISMATCH`, `BUDGET_TARGET_OVERLAP`, `BUDGET_INVALID_LINE_KIND`, `IDEMPOTENCY_KEY_REUSED` |

Esquemas nuevos:

```yaml
BudgetSuggestionRequest:
  type: object
  additionalProperties: false
  required: [periodId]
  properties:
    periodId: { $ref: '#/components/schemas/Uuid' }
    method: { type: string, enum: [AVERAGE, SAME_PERIOD_LAST_YEAR], default: AVERAGE }
    periods: { type: integer, minimum: 1, maximum: 12, default: 6, description: 'N (only AVERAGE).' }
    adjustmentPercent: { $ref: '#/components/schemas/DecimalString', description: 'From -100.00 to 1000.00, scale 2.' }
    roundingIncrement: { type: [integer, 'null'], enum: [1, 5, 10, 50, 100, null] }
    extraTargets:
      type: array
      maxItems: 50
      items: { $ref: '#/components/schemas/BudgetTarget' }
    overrides:
      type: array
      maxItems: 200
      items:
        type: object
        additionalProperties: false
        required: [target]
        properties:
          target: { $ref: '#/components/schemas/BudgetTarget' }
          excludePeriodIds: { type: array, maxItems: 12, items: { $ref: '#/components/schemas/Uuid' } }
          includePeriodIds: { type: array, maxItems: 12, items: { $ref: '#/components/schemas/Uuid' }, description: 'Only periods flagged OUTLIER.' }
BudgetSuggestionPreview:
  type: object
  required: [periodId, budgetId, budgetVersion, currency, method, periods, token, window, lines]
  properties:
    periodId: { $ref: '#/components/schemas/Uuid' }
    budgetId: { type: [string, 'null'], format: uuid }
    budgetVersion: { type: [integer, 'null'] }
    currency: { $ref: '#/components/schemas/CurrencyCode' }
    method: { type: string, x-extensible-enum: [AVERAGE, SAME_PERIOD_LAST_YEAR] }
    periods: { type: integer }
    adjustmentPercent: { $ref: '#/components/schemas/DecimalString' }
    roundingIncrement: { type: [integer, 'null'] }
    token: { type: string, pattern: '^[0-9a-f]{64}$' }
    window:
      type: array
      items: { $ref: '#/components/schemas/BudgetSuggestionWindowPeriod' }   # periodId|null, label, start, end, closed
    lines:
      type: array
      items: { $ref: '#/components/schemas/BudgetSuggestionLine' }
BudgetSuggestionLine:
  type: object
  required: [target, targetName, nature, kind, existingLineId, currentAmount, suggestedAmount, difference, status, explanation]
  properties:
    target: { $ref: '#/components/schemas/BudgetTarget' }
    targetName: { type: string }
    nature: { type: string, enum: [EXPENSE, INCOME] }
    kind: { $ref: '#/components/schemas/BudgetLineKind' }        # vigente o propuesto
    existingLineId: { type: [string, 'null'], format: uuid }
    currentAmount: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'null' }] }
    suggestedAmount: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'null' }] }
    difference: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'null' }] }
    status: { type: string, x-extensible-enum: [OK, INSUFFICIENT_HISTORY, NOT_APPLICABLE] }
    explanation: { $ref: '#/components/schemas/BudgetHistoryBasis' }
BudgetHistoryBasis:          # también es la propiedad opcional `historyBasis` de BudgetLine
  type: object
  required: [method, periodsRequested, usedCount, periods]
  properties:
    method: { type: string, x-extensible-enum: [AVERAGE, SAME_PERIOD_LAST_YEAR] }
    periodsRequested: { type: integer }
    adjustmentPercent: { $ref: '#/components/schemas/DecimalString' }
    roundingIncrement: { type: [integer, 'null'] }
    usedCount: { type: integer }
    minValid: { type: integer }
    outlierRule: { type: string, x-extensible-enum: [TUKEY_1_5_IQR, NONE_SMALL_SAMPLE] }
    q1: { type: [string, 'null'] }
    q3: { type: [string, 'null'] }
    mean: { type: [string, 'null'] }
    median: { type: [string, 'null'] }
    suggested: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'null' }] }
    applied: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'null' }] }   # solo en historyBasis
    modifiedAfterSuggestion: { type: boolean }                                        # solo en historyBasis
    computedAt: { $ref: '#/components/schemas/Instant' }
    periods:
      type: array
      items:
        type: object
        required: [label, start, end, closed, actual, status]
        properties:
          periodId: { type: [string, 'null'], format: uuid }
          label: { type: string }
          start: { $ref: '#/components/schemas/LocalDate' }
          end: { $ref: '#/components/schemas/LocalDate' }
          closed: { type: boolean }
          actual: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'null' }] }
          status: { type: string, x-extensible-enum: [USED, OUTLIER, INCOMPLETE, BEFORE_FIRST_ACTIVITY, NO_RATE, IN_PROGRESS, USER_EXCLUDED] }
BudgetSuggestionConfirm:
  type: object
  additionalProperties: false
  required: [token, request, lines]
  properties:
    token: { type: string, pattern: '^[0-9a-f]{64}$' }
    request: { $ref: '#/components/schemas/BudgetSuggestionRequest' }
    lines:
      type: array
      minItems: 1
      maxItems: 200
      items:
        type: object
        additionalProperties: false
        required: [target, nature, amount, suggestedAmount]
        properties:
          target: { $ref: '#/components/schemas/BudgetTarget' }
          nature: { type: string, enum: [EXPENSE, INCOME] }
          kind: { $ref: '#/components/schemas/BudgetLineKind' }   # obligatorio para líneas nuevas
          amount: { $ref: '#/components/schemas/Money' }
          suggestedAmount: { $ref: '#/components/schemas/Money' }
```

- Los nombres de los esquemas existentes (`BudgetTarget`, `BudgetLineKind`, `Money`, `DecimalString`, `CurrencyCode`, `LocalDate`, `Instant`, `Uuid`) se verifican contra el YAML al implementar (tarea 6.1). Si alguno tiene otro nombre, se usa el vigente.
- `BudgetLine` gana `historyBasis` opcional (`oneOf: [BudgetHistoryBasis, null]`), que no entra en `required`.
- `ErrorCode` (`x-extensible-enum`) gana `BUDGET_SUGGESTION_STALE` (409, "la historia o el plan cambiaron desde la vista previa") con mensajes es/en/pt.
- `pnpm contract:breaking` limpio. Las descripciones YAML con comas dentro de mapeos en línea van entre comillas.

### Contratos públicos

Ninguno nuevo. Planning consume `NominalFlowQuery`, `FxValuationPort`, `CategoryCatalogQuery.categoryTree`, `LedgerActivityRangeQuery` y `WorkspaceCalendarQuery`, todos existentes. `BudgetVsActualQuery` (contrato de Planning) no cambia.

### Eventos

Sin eventos nuevos ni cambios de esquema. La confirmación sobre un periodo sin plan emite `planning.BudgetCreated.v1` (origen `EMPTY`). Los cruces de umbral que provoque el cambio de montos se emiten con el mecanismo vigente (idempotente por umbral y periodo).

## Modelo de datos (expand-only)

| Tabla | Cambio | RLS y grants |
|---|---|---|
| `planning.budget_line` | `history_basis jsonb NULL`; CHECK `budget_line_history_basis_ck (history_basis IS NULL OR jsonb_typeof(history_basis) = 'object')` agregado `NOT VALID` y validado en la misma migración (tabla chica) | Sin cambios: RLS forzada por `workspace_id` y registro existente en `platform.workspace_scoped_table` |

- Migración `2026110xxxxxxx_planning_budget_line_history_basis.sql`, con timestamp posterior a la última de `main` al implementar.
- El export agrega la propiedad a la sección de líneas de plan (versión menor del formato; los archivos anteriores siguen importándose con `history_basis = NULL`).

## Rendimiento

- Una consulta de agregados para hasta 13 periodos (N = 12 más el año anterior) y un lote de tasas. Por periodo y línea, la consolidación es en memoria.
- Objetivo: p95 ≤ 800 ms con N = 12 y 60 líneas sobre el seed `large`, alineado con NFR-PERF-006 (reportes de 12 meses). Benchmark nightly con TC-PLANNING-HISTBUDGET-029.
- La confirmación recalcula solo las líneas elegidas, con el mismo costo acotado.
- **Conexiones:** sin consumidores, colas ni jobs nuevos. El presupuesto de D249 no cambia.

## Riesgos / Trade-offs

- **Historia corta o sin cerrar:** el owner no tiene meses cerrados (docs/38 §2). Con "solo cerrados" la función no serviría hoy; con "terminados" se sugiere sobre datos que todavía pueden corregirse. Mitigación: cada periodo indica si está cerrado y el token detecta cambios entre la vista previa y la confirmación (pregunta 2).
- **Categorías reestructuradas:** si el usuario movió subcategorías, el real histórico se calcula con el árbol **actual** (igual que el progreso). Queda documentado en la explicación ("según tus categorías de hoy").
- **Tukey con N chico:** con N < 4 no hay exclusión automática; la exclusión manual cubre el caso.
- **Diferencia con FR-PLANNING-021 literal** (tipo vs. método): documentada en la decisión 1 y la pregunta 1.
- **Coordinación con `reporting/financial-reports`** (otro hilo de Phase 7): si ese change publica una serie mensual por categoría como contrato, Planning podría consumirla. Hoy no existe, y Planning ya calcula su real con `NominalFlowQuery`, sin acoplarse a Reporting.

## Plan de migración

1. Migración expand (columna nula, CHECK `NOT VALID` + `VALIDATE`).
2. Despliegue del código: las líneas existentes quedan con `history_basis = NULL`. Sin backfill.
3. Rollback: el código anterior ignora la columna. Nada destructivo.

## Dependencias entre changes

- **Ninguna bloqueante:** `planning/budgets`, `planning/budget-templates` y `planning/financial-periods` están archivados.
- **`add-month-closing`** (sin archivar, evidencia del owner): solo aporta el estado "cerrado" que la explicación informa.
- **Otros changes de Phase 7** (reportes financieros, cash-flow forecast): sin capabilities compartidas. Punto de coordinación: no duplicar una "serie mensual por categoría" pública. Si `reporting/financial-reports` la crea, se evalúa consumirla en una iteración posterior.
- **`add-rule-suggestions`** (este mismo hilo): independiente. Se pueden implementar en paralelo.

## Preguntas abiertas

1. **[B] ¿FR-PLANNING-021 como método de sugerencia o como tipo de línea?** Opciones:
   - (a) método de sugerencia que fija un monto tras la confirmación, con la base guardada (decisión 1);
   - (b) tipos `AVERAGE_BASED`/`HISTORICAL_BASED` que recalculan el planificado al crear el periodo, sin confirmación;
   - (c) tipos que recalculan en cada lectura.

   **Recomendación: (a)**: cumple "revisable, no automática", no mueve planes aprobados y no complica los umbrales. Bloquea los grupos 2 a 6.
2. **¿Periodos "cerrados" (literal de FR) o "terminados"?** Opciones:
   - (a) terminados, cerrados o no, con la marca de cerrado en la explicación;
   - (b) solo cerrados;
   - (c) terminados por omisión y "solo cerrados" como opción de la vista previa.

   **Recomendación: (a)**: el owner aún no cerró meses reales, y (b) dejaría la función sin datos. No bloquea: es un filtro en `HistoricalBudgetEstimator`.
3. **Valores por omisión y método de atípicos.** N = 6, mínimo ⌈N/2⌉, Tukey 1.5 × RIC con n ≥ 4, ajuste 0 % y sin redondeo a múltiplos. Opciones:
   - (a) aceptarlos (configurables en `PLANNING_HISTORY_*`);
   - (b) N = 3 por omisión (sin atípicos automáticos salvo que se pida más);
   - (c) otro método de la tabla de la decisión 4.

   **Recomendación: (a)**. No bloquea.
4. **¿Borrador persistido?** Opciones:
   - (a) vista previa sin estado y confirmación en la misma sesión (como la propagación);
   - (b) borrador guardado para retomarlo después.

   **Recomendación: (a)**. No bloquea.
5. **Prioridad.** FR-PLANNING-021 y US-231 son Could, pero docs/24 §5.7 los pone en el alcance de Phase 7. Opciones:
   - (a) subir average/historical a Should para Phase 7;
   - (b) mantener Could (se implementa si queda capacidad);
   - (c) pasar al backlog.

   **Recomendación: (a)**: con la historia que ya dejan los imports de Phase 6 es la mejora más barata del plan mensual. No bloquea el diseño, sí el orden de implementación de Phase 7.

## Cambios a docs compartidos

- **docs/01 §8.2 FR-PLANNING-021:** nota as-built: métodos de sugerencia (promedio de los últimos N periodos terminados, con exclusión de incompletos y atípicos; mismo periodo del año anterior ± ajuste) aplicados con confirmación sobre tipos existentes; no son tipos que se recalculan. Ajustar la prioridad según la pregunta 5.
- **docs/08 (planning):** columna `planning.budget_line.history_basis` y su forma `schemaVersion 1`.
- **docs/10:** operaciones `previewBudgetSuggestions` y `confirmBudgetSuggestions`, `historyBasis` en `BudgetLine` y el código `BUDGET_SUGGESTION_STALE` en §9.1.
- **docs/11:** sin eventos nuevos (nota: la confirmación reutiliza `BudgetCreated.v1` y los cruces de umbral).
- **docs/14:** referencia a que el real histórico de los presupuestos usa la misma valoración de flujos (D109).
- **docs/25 US-231:** criterios de aceptación (explicación, exclusión de atípicos y confirmación explícita).
- **docs/28:** pantalla "Sugerir desde el historial" del plan, explicación por línea e indicador en la línea.
- **docs/config-reference.md:** `PLANNING_HISTORY_DEFAULT_PERIODS` (6), `PLANNING_HISTORY_MAX_PERIODS` (12), `PLANNING_HISTORY_MIN_VALID_RATIO` (0.5), `PLANNING_HISTORY_OUTLIER_MIN_SAMPLE` (4), `PLANNING_HISTORY_OUTLIER_IQR_FACTOR` (1.5).
- **docs/03 §7:** fila del change en Phase 7 (`planning/budgets` + `identity/workspace-portability`).
- **docs/38:** estado del change y las preguntas 1–5.
