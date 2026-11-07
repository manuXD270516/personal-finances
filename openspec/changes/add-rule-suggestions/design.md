# Diseño: add-rule-suggestions

## Contexto

- **FR-RULES-011** (Could, Phase 7): "Sugerir reglas a partir de recategorizaciones manuales repetidas (≥ 3 veces mismo patrón)". docs/24 §5.7 lo incluye en el alcance de Phase 7; US-232 (docs/25, FEAT-21.5) es Could.
- **Base implementada por `add-rule-engine`** (Phase 6, en `main`, sin archivar por la evidencia 7.5 del owner):
  - contexto `@pf/rules`: reglas versionadas en JSONB, evaluador puro `RuleEvaluator` con "primer escritor gana" por campo (D333), `previewRule` con definición sin guardar, `RuleDryRunService` (≤ 366 días, ≤ 5 000 transacciones, token) y `applyRuleDryRun` (≤ 500, auditado);
  - en Transactions, `transaction_split.category_origin` (`MANUAL`, `RULE`, `COUNTERPARTY_DEFAULT`, `SYSTEM_DEFAULT`; `NULL` ⇒ `UNKNOWN`) y `ClassificationSubjectsQuery` (`list` por keyset ascendente, `byIds`), cuyo DTO ya trae `categoryOrigin`, `splitCount`, `managedBy` y `externalSource`;
  - la UI ya prellena una regla desde una fila con `ruleTextFromDescription` (TC-RULES-ENGINE-054), en `apps/web`.
- **Decisiones vigentes:**
  - D333 (semántica);
  - D334 (cobertura: solo `RULE` vigente);
  - D335 ("split por porcentajes" y "vincular a meta" diferidas a Phase 7);
  - D336 (las reglas no actúan sobre transferencias ni conversiones);
  - D337 (las reglas nuevas no traen el disparador de alta manual);
  - D338 (sin aplicación asíncrona);
  - D339 (límites `RULES_*`);
  - D346 (nada se auto-aprueba);
  - D249 (sin consumidores nuevos: 64 de 67 conexiones útiles).

## Objetivos / No objetivos

**Objetivos**

- Detectar patrones de clasificación manual repetida con un algoritmo determinista y explicable (sin ML).
- Mostrar evidencia, confianza, contraejemplos y conflictos con reglas existentes.
- Probar la sugerencia sobre la historia sin efectos y crear la regla solo con aceptación explícita.
- No sumar jobs, colas ni consumidores.

**No objetivos**

- Acciones "split por porcentajes" y "vincular a meta" (pregunta 4).
- Sugerir etiquetas, contraparte, renombres o campos personalizados.
- Sugerir reglas para transferencias y conversiones (D336).
- Notificar sugerencias nuevas o calcularlas en segundo plano.
- Aprender pesos o usar modelos (Phase 8).

## Decisiones

### 1. Cálculo a pedido, sin estado persistido de las sugerencias

| Opción | Cómo funciona | Pros | Contras |
|---|---|---|---|
| **(a) A pedido (elegida)** | `GET W/rules/suggestions` lee la evidencia y calcula en memoria; solo se persisten las decisiones (aceptada o descartada) | Sin jobs ni consumidores (D249); siempre al día; nada que limpiar | Cada listado cuesta una consulta de ≤ 5 000 filas y una evaluación (≤ 3 s, cuota `costly`) |
| (b) Consumidor de `TransactionUpdated`/`TransactionCategorized` | Mantiene contadores por patrón | Listado instantáneo | Consumidor nuevo contra D249; contadores a reconciliar con anulaciones y correcciones |
| (c) Job nocturno | Recalcula y guarda | Sin costo en la petición | Infraestructura de jobs por workspace; datos de ayer; tabla de sugerencias con ciclo de vida |

La identidad estable de una sugerencia es su **huella**: SHA-256 hex de `v1|<DESCRIPTION|COUNTERPARTY>|<valor>|<kind>|<categoryId>`, donde el valor es la clave de descripción o el id de la contraparte. Con la huella se descarta y se acepta sin guardar la sugerencia. El servidor la recalcula desde el patrón que envía el cliente: si no coincide, `VALIDATION_FAILED`.

### 2. Evidencia

- **Fuente:** método aditivo `ClassificationSubjectsQuery.listEvidence({ workspaceId, from, to, limit ≤ 5000 })` de Transactions. Devuelve `ClassificationSubjectDto` + `source` en orden `(transaction_date DESC, id DESC)` y `truncated`. El filtro va en SQL:
  - no anuladas, `INCOME | EXPENSE | REFUND`, un split, `managed_by IS NULL`;
  - categoría distinta de la de sistema "sin categoría";
  - `category_origin = 'MANUAL'`, o `category_origin IS NULL` con `source IN ('MANUAL','IMPORT')` (pregunta 1).
- Índice parcial nuevo `txn.transaction_split (workspace_id, category_id) WHERE superseded_in_revision IS NULL AND (category_origin = 'MANUAL' OR category_origin IS NULL)`, `CONCURRENTLY` en migración aparte. Se verifica con `EXPLAIN` en la tarea 4.2; si el índice existente por fecha basta, se omite y se registra.
- Las categorías archivadas se descartan en RULES con `ClassificationValidator` (un lote).
- **Por qué `UNKNOWN` cuenta:** antes del motor de reglas, una transacción con categoría distinta de "sin categoría" y `source` `MANUAL` o `IMPORT` solo pudo clasificarla una persona (formulario, edición o edición masiva; el import de Phase 3 creaba "sin categoría"). Recurrentes, préstamos, metas y tarjetas tienen otro `source` y quedan fuera. Sin esto, la historia del owner anterior al 2026-10-30 no aportaría nada.

### 3. Patrones

- **`DescriptionKey`** (dominio de RULES, canónica):
  1. `normalizeText` de `@pf/shared-kernel/text`;
  2. separar por espacios;
  3. quitar palabras con dígitos o `*` y palabras de un carácter;
  4. tomar las 5 primeras;
  5. exigir ≥ 3 letras en total.

  `ruleTextFromDescription` de la UI pasa a apoyarse en los mismos vectores de prueba (TC-RULES-SUGGEST-007 incluye los de TC-RULES-ENGINE-054). Si difieren, manda el dominio.
- **Contraparte:** `counterpartyId` de la transacción.
- **Agrupación:** por `(tipo de patrón, valor, kind)`. `REFUND` no se mezcla con `EXPENSE` (la condición `KIND` los distingue).
- **Deduplicación:** se quita la sugerencia por descripción cuya evidencia está contenida en la de una sugerencia por contraparte con la misma categoría y el mismo `kind`. La contraparte es más estable que la glosa bancaria.
- **Condición de la regla sugerida:**
  - `DESCRIPTION contains <clave>` o `COUNTERPARTY equals <id>`, más `KIND equals <kind>`;
  - acción `SET_CATEGORY`;
  - disparadores por omisión (`IMPORT`, `RETROACTIVE`; D337);
  - `matchMode ALL`, `stopProcessing false`;
  - prioridad 100 o la de la decisión 5;
  - nombre propuesto `<Categoría>: <clave o contraparte>` truncado a 80 y editable.
- **Alternativa descartada:** prefijo común más largo entre glosas. Es más general, pero menos predecible y más caro. Se reconsidera si la cobertura real del owner lo pide.

### 4. Confianza

- `n` = evidencia del patrón y del `kind`; `k` = evidencia en la categoría dominante; `confianza = k ÷ n` con 4 decimales HALF_EVEN (`Decimal`).
- Se sugiere si `k ≥ RULES_SUGGEST_MIN_SUPPORT` (3), `confianza ≥ RULES_SUGGEST_MIN_CONFIDENCE` (0.8000) y la categoría dominante es única (un empate en `k` no sugiere).
- Nivel: "alta" si `confianza ≥ 0.9500` y `k ≥ 5`; "media" en otro caso. El nivel es solo presentación; el orden usa apoyo, confianza y patrón.

### 5. Cobertura y conflictos con las reglas activas

- Se cargan las reglas activas no archivadas (una consulta) y se evalúan con `RuleEvaluator` en modo `FILL_EMPTY` sobre la evidencia, con la categoría vacía y **cualquier disparador** (parámetro nuevo del evaluador, `triggerFilter: 'ANY'`). Una regla solo de importación también "cubre" el patrón para lo que se importe.
- Si la categoría resultante es la sugerida en **toda** la evidencia ⇒ cubierto, no se sugiere. Si en alguna es otra ⇒ conflicto: se lista `{ ruleId, name, version, priority, categoryId, count }` y se propone `priority = min(prioridades en conflicto) − 1`, con mínimo 0. Si el mínimo en conflicto ya es 0 ⇒ aviso `CANNOT_OUTRANK` (empata y decide la antigüedad, D333).
- Costo: ≤ 5 000 sujetos × 200 reglas, el mismo orden que la evaluación del import (≤ 3 s, decisión 9 de `add-rule-engine`).

### 6. Vista previa: el motor del dry-run con una regla transitoria

- `POST W/rules/suggestions/preview` recibe la huella, el patrón y, opcionalmente, la definición editada (misma forma que `RulePreviewInput.definition`). Lee los sujetos de la ventana con `ClassificationSubjectsQuery.list` (todos los orígenes, ≤ 5 000) y evalúa con el camino de `RuleDryRunService` usando la definición como regla transitoria (sin id persistido). Devuelve conteos y hasta 200 ítems.
- **Por qué no reutilizar `dryRunRules` tal cual:** su respuesta exige `ruleId` (uuid) y `ruleVersion ≥ 1` en cada cambio. Volverlos opcionales o nulos es un cambio incompatible para los clientes (oasdiff). El esquema propio evita eso; el motor es el mismo.
- Tras aceptar, "aplicar a lo existente" usa **sin cambios** `dryRunRules` y `applyRuleDryRun` con el `ruleId` nuevo (`FILL_EMPTY` por omisión). La UI encadena ambos pasos.

### 7. Aceptación por `createRule` y decisiones persistidas

- `RuleInput.fromSuggestion { suggestionId, pattern { type, value, kind, categoryId } }` (opcional). En la misma unidad de trabajo que la creación y su auditoría, `RulesService.createRule`:
  1. verifica la huella;
  2. inserta la decisión `ACCEPTED` con `rule_id`; si la clave ya existe ⇒ 409 `RULE_SUGGESTION_DECIDED` y no crea la regla.

  El resto (validación, `NAME_TAKEN`, `RULE_LIMIT_EXCEEDED`, versión 1) es el de cualquier regla.
- `Rule` gana `fromSuggestion { suggestionId, acceptedAt } | null`, leído de la decisión.
- Descartar inserta `DISMISSED` (409 si ya hay decisión). Restaurar (Could) borra una decisión `DISMISSED` (404 si no existe; 409 si es `ACCEPTED`). Todo se audita con la entidad `RuleSuggestion`.
- Una sugerencia aceptada cuya regla luego se archiva no reaparece: la decisión sigue. Para volver a verla, el usuario crea la regla a mano.

### 8. Límites

- Ventana: 180 días por omisión, 1–366 (`windowDays`).
- Evidencia ≤ 5 000 más recientes (`truncated`); ≤ 50 sugerencias, ordenadas por apoyo desc, confianza desc y patrón asc.
- Evidencia mostrada ≤ 20; contraejemplos ≤ 20; ítems de la vista previa ≤ 200.
- Cuota `costly` en listar y probar. Configuración en `@pf/platform`:

| Variable | Valor por omisión |
|---|---|
| `RULES_SUGGEST_WINDOW_DAYS` | 180 |
| `RULES_SUGGEST_MAX_WINDOW_DAYS` | 366 |
| `RULES_SUGGEST_MIN_SUPPORT` | 3 |
| `RULES_SUGGEST_MIN_CONFIDENCE` | 0.8000 |
| `RULES_SUGGEST_HIGH_CONFIDENCE` | 0.9500 |
| `RULES_SUGGEST_HIGH_MIN_SUPPORT` | 5 |
| `RULES_SUGGEST_MAX_EVIDENCE` | 5000 |
| `RULES_SUGGEST_MAX_RESULTS` | 50 |

### Capas afectadas

| Contexto | Capa | Cambio |
|---|---|---|
| RULES | domain | `DescriptionKey`, `ProposalFingerprint`, DS `RuleProposalMiner` (agrupación, confianza, deduplicación, cobertura y conflictos); `RuleEvaluator` con `triggerFilter: 'ANY'` |
| RULES | application | `RuleProposalsService` (`list`, `preview`, `dismiss`, `restore`); `RulesService.createRule` con `fromSuggestion`; extracción en `RuleDryRunService` de la evaluación de un rango con reglas dadas (transitorias o guardadas) |
| RULES | infrastructure | `PgRuleProposalDecisionRepository`; migración; sección `rule-suggestion-decisions` del export |
| RULES | interface | Rutas `rules/suggestions` en `rules-http.ts` |
| Transactions | application e infrastructure | `ClassificationSubjectsQuery.listEvidence` (contrato aditivo) y su consulta |
| `apps/web` | UI | Pestaña "Sugerencias" con tarjetas (patrón, categoría, confianza, apoyo), evidencia y contraejemplos desplegables, vista previa, "Aceptar…" que abre el editor prellenado, "Descartar", listado de descartadas con "Restaurar"; tras aceptar, la oferta "Aplicar a transacciones existentes" con el dry-run |

## Contratos

### OpenAPI (aditivo, tag Rules, `x-openspec-capability: rules/rule-engine`)

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `listRuleSuggestions` | `GET W/rules/suggestions` | VIEWER | `x-rate-limit: costly`. Query `windowDays` (1–366, 180) e `includeDismissed` (false). Respuesta `RuleSuggestionList`. Sin efectos ni auditoría |
| `previewRuleSuggestion` | `POST W/rules/suggestions/preview` | VIEWER | `x-rate-limit: costly`. Cuerpo `RuleSuggestionPreviewInput`; respuesta `RuleSuggestionPreview`. 422 `VALIDATION_FAILED`, `RULE_INVALID_REGEX` |
| `dismissRuleSuggestion` | `POST W/rules/suggestions/{suggestionId}/dismiss` | EDITOR | `Idempotency-Key`. Cuerpo `{ pattern: RuleSuggestionPattern }`; 204. 409 `RULE_SUGGESTION_DECIDED`; 422 `VALIDATION_FAILED` (huella que no coincide) |
| `restoreRuleSuggestion` | `POST W/rules/suggestions/{suggestionId}/restore` | EDITOR | 204. 404 `NOT_FOUND`; 409 `RULE_SUGGESTION_DECIDED` (estaba aceptada) |
| `createRule` (existente) | `POST W/rules` | EDITOR | `RuleInput.fromSuggestion` opcional; 409 `RULE_SUGGESTION_DECIDED` además de los vigentes |

Esquemas nuevos:

```yaml
RuleSuggestionPattern:
  type: object
  additionalProperties: false
  required: [type, value, kind, categoryId]
  properties:
    type: { type: string, enum: [DESCRIPTION, COUNTERPARTY] }
    value: { type: string, minLength: 1, maxLength: 200, description: 'Description key or counterparty id.' }
    kind: { type: string, enum: [INCOME, EXPENSE, REFUND] }
    categoryId: { $ref: '#/components/schemas/Uuid' }
RuleSuggestion:
  type: object
  required: [suggestionId, pattern, categoryName, support, total, confidence, confidenceLevel, proposedRule, evidence, counterExamples, conflicts, warnings, status]
  properties:
    suggestionId: { type: string, pattern: '^[0-9a-f]{64}$' }
    pattern: { $ref: '#/components/schemas/RuleSuggestionPattern' }
    patternLabel: { type: string, description: 'Counterparty name for COUNTERPARTY patterns.' }
    categoryName: { type: string }
    support: { type: integer, minimum: 3 }
    total: { type: integer }
    confidence: { type: string, pattern: '^(0\.[0-9]{4}|1\.0000)$' }
    confidenceLevel: { type: string, x-extensible-enum: [HIGH, MEDIUM] }
    proposedRule: { $ref: '#/components/schemas/RuleInput' }          # sin fromSuggestion; el cliente lo agrega al aceptar
    evidence: { type: array, maxItems: 20, items: { $ref: '#/components/schemas/RuleSuggestionEvidence' } }
    counterExamples: { type: array, maxItems: 20, items: { $ref: '#/components/schemas/RuleSuggestionEvidence' } }
    conflicts:
      type: array
      items:
        type: object
        required: [ruleId, name, version, priority, categoryId, count]
        properties:
          ruleId: { $ref: '#/components/schemas/Uuid' }
          name: { type: string }
          version: { type: integer }
          priority: { type: integer }
          categoryId: { $ref: '#/components/schemas/Uuid' }
          count: { type: integer }
    warnings: { type: array, items: { type: string, x-extensible-enum: [CANNOT_OUTRANK] } }
    status: { type: string, x-extensible-enum: [OPEN, DISMISSED] }
RuleSuggestionEvidence:
  type: object
  required: [transactionId, date, description, amount, accountId, categoryId, categoryOrigin]
  properties:
    transactionId: { $ref: '#/components/schemas/Uuid' }
    date: { $ref: '#/components/schemas/LocalDate' }
    description: { type: [string, 'null'] }
    amount: { $ref: '#/components/schemas/Money' }
    accountId: { $ref: '#/components/schemas/Uuid' }
    categoryId: { $ref: '#/components/schemas/Uuid' }
    categoryOrigin: { $ref: '#/components/schemas/CategoryOrigin' }
RuleSuggestionList:
  type: object
  required: [generatedAt, from, to, scanned, truncated, items]
  properties:
    generatedAt: { $ref: '#/components/schemas/Instant' }
    from: { $ref: '#/components/schemas/LocalDate' }
    to: { $ref: '#/components/schemas/LocalDate' }
    scanned: { type: integer }
    truncated: { type: boolean }
    items: { type: array, maxItems: 50, items: { $ref: '#/components/schemas/RuleSuggestion' } }
RuleSuggestionPreviewInput:
  type: object
  additionalProperties: false
  required: [suggestionId, pattern]
  properties:
    suggestionId: { type: string, pattern: '^[0-9a-f]{64}$' }
    pattern: { $ref: '#/components/schemas/RuleSuggestionPattern' }
    definition: { description: 'Edited candidate; same shape as RulePreviewInput.definition. Absent means the proposed rule.' }
    windowDays: { type: integer, minimum: 1, maximum: 366 }
RuleSuggestionPreview:
  type: object
  required: [from, to, scanned, truncated, matched, wouldFill, alreadyInCategory, otherCategory, notApplicable, items]
  properties:
    from: { $ref: '#/components/schemas/LocalDate' }
    to: { $ref: '#/components/schemas/LocalDate' }
    scanned: { type: integer }
    truncated: { type: boolean }
    matched: { type: integer }
    wouldFill: { type: integer }
    alreadyInCategory: { type: integer }
    otherCategory: { type: integer }
    notApplicable: { type: integer }
    items:
      type: array
      maxItems: 200
      items:
        type: object
        required: [transactionId, date, description, amount, currentCategoryId, currentOrigin, proposedCategoryId, outcome, reasons]
        properties:
          transactionId: { $ref: '#/components/schemas/Uuid' }
          date: { $ref: '#/components/schemas/LocalDate' }
          description: { type: [string, 'null'] }
          amount: { $ref: '#/components/schemas/Money' }
          currentCategoryId: { type: [string, 'null'], format: uuid }
          currentOrigin: { $ref: '#/components/schemas/CategoryOrigin' }
          proposedCategoryId: { $ref: '#/components/schemas/Uuid' }
          outcome: { type: string, x-extensible-enum: [WOULD_FILL, ALREADY_IN_CATEGORY, OTHER_CATEGORY, NOT_APPLICABLE] }
          reasons: { type: array, items: { $ref: '#/components/schemas/RuleSkipReason' } }
```

- `RuleInput` gana `fromSuggestion: { suggestionId, pattern }` (opcional; `additionalProperties: false` en el objeto nuevo).
- `Rule` gana `fromSuggestion: { suggestionId, acceptedAt } | null` (opcional en la respuesta).
- `ErrorCode` (`x-extensible-enum`) gana `RULE_SUGGESTION_DECIDED` (409, "la sugerencia ya fue aceptada o descartada") con mensajes es/en/pt.
- Los nombres de los esquemas reutilizados (`CategoryOrigin`, `Money`, `LocalDate`, `Instant`, `Uuid`, `RuleSkipReason`) se verifican contra el YAML al implementar (tarea 5.1).
- `pnpm contract:breaking` limpio.

### Contrato público de Transactions (aditivo)

```ts
export interface ClassificationEvidenceDto extends ClassificationSubjectDto {
  /** `source` de la transacción (`MANUAL`, `IMPORT`, …). */
  readonly source: string;
}

export interface ClassificationSubjectsQuery {
  // list y byIds sin cambios
  /**
   * Evidencia de clasificación manual (add-rule-suggestions): no anuladas, INCOME/EXPENSE/REFUND, un split, sin
   * `managedBy`, categoría distinta de «sin categoría», origen MANUAL o desconocido con source MANUAL/IMPORT.
   * Orden (fecha DESC, id DESC), hasta `limit` (≤ 5 000). Sin efectos; en la unidad de trabajo del llamador.
   */
  listEvidence(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
    readonly limit: number;
  }): Promise<{ readonly items: readonly ClassificationEvidenceDto[]; readonly truncated: boolean }>;
}
```

### Eventos

Ninguno nuevo ni modificado. Aceptar crea una regla (sin eventos de dominio de reglas, como hoy). Aplicar a la historia usa el dry-run, que emite los eventos de la edición masiva sin cambio de esquema.

## Modelo de datos (expand-only)

| Tabla | Columnas y restricciones | RLS y grants |
|---|---|---|
| `rules.rule_suggestion_decision` (nueva) | `workspace_id uuid`, `suggestion_id char(64)`, `pattern_type text CHECK IN ('DESCRIPTION','COUNTERPARTY')`, `pattern_value text CHECK (char_length BETWEEN 1 AND 200)`, `kind text CHECK IN ('INCOME','EXPENSE','REFUND')`, `category_id uuid`, `decision text CHECK IN ('ACCEPTED','DISMISSED')`, `rule_id uuid NULL`, `support int`, `total int`, `confidence numeric(5,4)`, `decided_at timestamptz`, `decided_by uuid`. PK `(workspace_id, suggestion_id)`; CHECK `(decision = 'ACCEPTED') = (rule_id IS NOT NULL)`; FK `(workspace_id, rule_id)` → `rules.rule (workspace_id, id)`; índice `(workspace_id, rule_id) WHERE rule_id IS NOT NULL` | RLS forzada por `workspace_id`, fail-closed (`PF002` sin contexto); `pf_app` SELECT, INSERT, DELETE; `pf_worker` SELECT; registro en `platform.workspace_scoped_table`; `retention_scan` no aplica |
| `txn.transaction_split` | Índice parcial de evidencia (decisión 2), `CONCURRENTLY` en migración aparte, si `EXPLAIN` lo justifica | Sin cambios |

- Migraciones con timestamp posterior a la última de `main` al implementar.
- Export: sección `rule-suggestion-decisions` con orden posterior a `rules` (versión menor del formato; los archivos anteriores se importan sin decisiones).

## Rendimiento

- Listar: una consulta de evidencia (≤ 5 000), una de reglas activas y una de categorías activas; agrupación O(n) y evaluación ≤ 5 000 × 200. Objetivo ≤ 3 s (benchmark nightly, TC-RULES-SUGGEST-024). El caso típico del owner (cientos de transacciones por trimestre) queda muy por debajo.
- Probar: una consulta de sujetos (≤ 5 000) y la evaluación de una regla. ≤ 1 s esperado, sin umbral propio.
- **Conexiones:** sin consumidores, colas ni jobs nuevos. El presupuesto de D249 no cambia.

## Riesgos / Trade-offs

- **Patrones demasiado amplios** (p. ej. `pago qr` agrupa comercios distintos): la confianza baja los descarta cuando las categorías difieren; si coinciden por casualidad, la vista previa muestra lo que tocaría y el usuario edita la condición antes de aceptar.
- **Evidencia `UNKNOWN` mal atribuida** (pregunta 1): un split antiguo con categoría por un camino no manual que no se conozca. Mitigación: se filtra por `source` y la sugerencia nunca se aplica sola.
- **Costo por petición:** cuota `costly` y límites. Si el uso real lo pide, se agrega un caché por workspace invalidado por versión de reglas (sin consumidor).
- **Dependencia de archivado:** `rules/rule-engine` la crea `add-rule-engine`, que espera la evidencia 7.5 del owner. Este change se archiva después; la implementación no depende del archivado.

## Plan de migración

1. Migración de `rules.rule_suggestion_decision` (tabla, RLS, grants, registro).
2. Índice parcial de evidencia `CONCURRENTLY`, si aplica.
3. Despliegue del código. Rollback: el código anterior ignora la tabla; nada destructivo.

## Dependencias entre changes

- **`add-rule-engine`** (Phase 6, implementado): requisito de código (en `main`) y de archivado (crea `rules/rule-engine`). Archivar este change **después**.
- **`add-import-pipeline`** (implementado): sin cambios. Lo importado y corregido a mano en la vista previa queda con origen `MANUAL` y alimenta la evidencia.
- **`add-historical-budgets`** (este hilo): independiente; se pueden implementar en paralelo.
- **Otros changes de Phase 7** (reportes, cash-flow): sin capabilities compartidas.

## Preguntas abiertas

1. **Evidencia anterior al motor de reglas.** Las transacciones del owner previas al 2026-10-30 tienen origen `UNKNOWN`. Opciones:
   - (a) contarlas cuando su categoría no es "sin categoría" y su `source` es `MANUAL` o `IMPORT` (decisión 2);
   - (b) contar solo `MANUAL` (las sugerencias empiezan a aparecer semanas después de usar el motor);
   - (c) contar `UNKNOWN` solo con `source = MANUAL`.

   **Recomendación: (a)**. No bloquea: es un filtro de `listEvidence`.
2. **Umbrales y ventana.** Apoyo ≥ 3 (FR), confianza ≥ 0.8000, "alta" ≥ 0.9500 con ≥ 5 y ventana de 180 días. Opciones:
   - (a) aceptarlos (configurables);
   - (b) confianza ≥ 0.9000;
   - (c) ventana de 365 días.

   **Recomendación: (a)**. No bloquea.
3. **Alcance de lo sugerido.** Opciones:
   - (a) solo categoría (FR-RULES-011 habla de recategorizaciones);
   - (b) también etiquetas y contraparte repetidas;
   - (c) además, ofrecer "categoría por defecto de la contraparte" como alternativa a la regla en los patrones por contraparte.

   **Recomendación: (a)** para Phase 7; (c) puede volver como mejora si el owner prefiere ese mecanismo. No bloquea.
4. **[B para el plan de Phase 7] Acciones diferidas por D335.**
   - "Vincular a meta": según `goals/savings-goals`, solo se vincula una **transferencia** posteada hacia una cuenta vinculada (`GOAL_TRANSACTION_NOT_ELIGIBLE` con motivo `KIND` para un gasto), y las reglas no actúan sobre transferencias (D336). La acción es imposible sin reabrir D336, y `goals.contribution-suggestions` ya sugiere el aporte de esas transferencias.
   - "Split por porcentajes" (largest remainder): choca con la regla vigente "las acciones de split solo aplican a transacciones de un split". Exige que una regla cree splits (montos por split en la escala de la moneda; el total no cambia), lo que pide su propio diseño en Transactions.

   Opciones:
   - (a) retirar "vincular a meta" de FR-RULES-005 (cubierto por las sugerencias de aporte) y pasar "split por porcentajes" al backlog hasta que el owner tenga un caso real;
   - (b) un change aparte en Phase 7 con ambas (y reabrir D336 para metas);
   - (c) solo "split por porcentajes" en un change aparte de Phase 7.

   **Recomendación: (a)**. No bloquea este change; sí define si Phase 7 tiene un change más.
5. **Prioridad.** FR-RULES-011 y US-232 son Could y docs/24 §5.7 los pone en el alcance. Opciones:
   - (a) subir a Should para Phase 7 (ayuda a sostener el 70 % de D334 con datos nuevos);
   - (b) mantener Could;
   - (c) backlog.

   **Recomendación: (a)**. No bloquea el diseño, sí el orden de implementación.

## Cambios a docs compartidos

- **docs/01 §15 FR-RULES-011:** nota as-built: evidencia (`MANUAL` y `UNKNOWN` con `source` manual o importado), patrones de descripción y de contraparte, apoyo ≥ 3, confianza ≥ 0.8000, cálculo a pedido, aceptación por `createRule`. **FR-RULES-005:** registrar la respuesta de la pregunta 4 (vincular a meta y split por porcentajes). Ajustar la prioridad según la pregunta 5.
- **docs/05 §2.13 (RULES):** sugerencias a pedido sin consumidores; dependencia de `ClassificationSubjectsQuery.listEvidence`.
- **docs/08 §5.13:** tabla `rules.rule_suggestion_decision`; índice parcial de evidencia en `txn.transaction_split`; sección del export.
- **docs/10:** operaciones `listRuleSuggestions`, `previewRuleSuggestion`, `dismissRuleSuggestion`, `restoreRuleSuggestion`; `fromSuggestion` en `RuleInput` y `Rule`; código `RULE_SUGGESTION_DECIDED` en §9.1.
- **docs/11:** sin eventos nuevos.
- **docs/13 §17:** las correcciones manuales en la vista previa del import alimentan las sugerencias.
- **docs/25 US-232:** criterios de aceptación (evidencia, confianza, vista previa y aceptación explícita).
- **docs/28:** pestaña "Sugerencias" de Reglas y el flujo aceptar → aplicar a lo existente.
- **docs/config-reference.md:** variables `RULES_SUGGEST_*` de la decisión 8.
- **docs/03 §7:** fila del change en Phase 7 (`rules/rule-engine` + `identity/workspace-portability`), archivado después de `add-rule-engine`.
- **docs/38:** estado del change y las preguntas 1–5.

## As-built (2026-11-05)

Desviaciones menores respecto de lo anterior, todas aditivas y sin cambiar el comportamiento especificado:

- **`total` → `evidenceCount`.** La regla Spectral `pfos-money-via-schema` y la ESLint `pf/no-number-money` reservan `total` (y los sufijos `Total`) para montos: el denominador de la confianza se llama `evidenceCount` en `RuleSuggestion`, en el dominio y en la columna `evidence_count` de `rules.rule_suggestion_decision`.
- **Aceptación: se reclama antes de crear.** `createRule` inserta la decisión `ACCEPTED` antes de las verificaciones de nombre, límite y catálogo, con la FK `(workspace_id, rule_id)` `DEFERRABLE INITIALLY DEFERRED`: así la segunda aceptación (también la simultánea) responde `RULE_SUGGESTION_DECIDED` y no `NAME_TAKEN`; si algo falla después, la transacción revierte la decisión.
- **Instantánea de la decisión.** `support`, `evidence_count` y `confidence` se calculan al decidir (nulos si el patrón ya no se calcula); descartar y aceptar relanzan el cálculo de la ventana por omisión.
- **SHA-256 puro en el dominio** (`domain/sha256.ts`): `domain-only-shared-kernel` impide importar `node:crypto`; se verifica contra `node:crypto` en `infrastructure/sha256.test.ts`.
- **Vista previa:** compila la regla transitoria sin el caché por `(id, versión)` de `RulesQueries` (se contaminaría) y reutiliza `toSubject` y los motivos de no aplicable del dry-run; no hizo falta extraer nada de `RuleDryRunService`.
- **Índice parcial de evidencia: no se crea.** `EXPLAIN` con 300 000 transacciones: 331 ms; el costo dominante son las búsquedas por clave primaria, que el índice no cambia (ver la tarea 4.2).
- **Calendario:** `RulesRuntimeOptions.calendar` entrega «hoy» en la zona del workspace (`workspaceCalendar`); la ventana es `[hoy − windowDays, hoy]`.
- **Limitación conocida de la clave de descripción:** al quitar las palabras con dígitos o asteriscos de en medio (`COMPRA TARJ ****1234 FARMACORP`), la clave no es una subcadena contigua de la glosa original y la condición `contains` de la regla propuesta podría no coincidir con su propia evidencia; la vista previa lo muestra y el usuario edita la condición. Si pasa a ser frecuente con datos reales, se reconsidera el prefijo común más largo (alternativa descartada de la decisión 3).
