# Diseño

## Contexto

Primer change predictivo de Phase 9 (change 72 de docs/03 §7, aprobado por D472). FORECAST ya existe (changes 64 a 66): contexto `@pf/forecasting`, trabajos `forecasting.schedule` (diario, 01:15 en La Paz) y `forecasting.runner` en la reserva de trabajos periódicos del worker, lectura de flujos con `NominalFlowQuery`, valoración por fecha con FX y lectura de las ocurrencias resueltas de COMMITMENTS (change 65). En N1 los pronósticos están deshabilitados (`FORECASTING_ENABLED=false`) hasta que la historia del owner pase la preparación, y con eso hoy `forecasting.schedule` ni siquiera se registra.

Decisiones del owner que aplican ([docs/77](../../../docs/77-phase-9-and-card-interest-decisions.md)): D473 (MAD en TypeScript dentro de `forecasting.schedule`, sin el servicio Python), D474 (lista y marca, aviso apagado por omisión, nunca bloquea ni modifica), D475 (sin detector de duplicados ni de precio), D483 (precisión ≥ 0.60 y recall ≥ 0.70 con el Large Seed), D465 (los cargos de tarjeta son `EXPENSE` con `debtRole = CARD_CHARGE`), D249 (sin consumidores ni conexiones nuevas).

## Objetivos / No objetivos

**Objetivos**
- Detectar gastos atípicos por categoría, por contraparte y por contraparte nueva, con motivos explicables.
- Funcionar con el servicio de pronósticos apagado y con los pronósticos deshabilitados.
- Lista, marca en la transacción, descarte y aviso opcional.
- Medir precisión y recall contra el Large Seed en el nightly.

**No objetivos**
- Isolation Forest u otro modelo en el servicio Python (mejora posterior, D473).
- Cargos duplicados y cambios de precio no anunciados (D475).
- Reglas o automatizaciones sobre los gastos atípicos (D479).
- Bloquear, retener o modificar transacciones.

## Decisiones

1. **Dónde vive.** En FORECAST, como pide D473, con una capability propia `forecast/anomaly-detection` (docs/24 §5.9 y ARCHITECTURE §14). *Alternativa descartada:* en REPORTING. REPORTING ya lee FORECAST (change 66) y el trabajo diario es de FORECAST; ponerlo en REPORTING obligaría a otro trabajo periódico.

2. **Fuente de datos: porciones de gasto por transacción.** `NominalFlowQuery` agrega por día y no sirve para comparar transacciones. Se agrega a `@pf/transactions/contracts` la query `ExpenseLineQuery.listExpenseLines({workspaceId, from, to, limit, after})`. Recorre por keyset `(fecha, id)`, en la unidad de trabajo del llamador y sin efectos. Devuelve por porción: `transactionId`, `version`, `date`, `status`, `accountId`, `counterpartyId`, `categoryId`, `splitIndex`, `amount {amount, currency}`, `managedBy` y `debtRole`. Solo trae `EXPENSE` no anulados con estado `POSTED`, `CLEARED` o `RECONCILED`. Las ocurrencias resueltas se leen con la query de COMMITMENTS que ya usa el change 65, y sus transacciones se excluyen. Los administrados (`managedBy` no nulo, incluidos los cargos de tarjeta de D465) se excluyen. El contrato es aditivo e interno, sin cambios en la API pública de transacciones.

3. **Valoración.** Cada porción se lleva a la moneda de reporte con la tasa de su fecha, con el mismo `FlowValuation` de las series del change 64. Sin tasa, la porción no se evalúa (motivo de métrica `NO_RATE`); no hay fallback a otra tasa, para no marcar por un tipo de cambio dudoso (RISK-017).

4. **Estadística (`RobustStats`, dominio puro, TDD y PBT).** Todo con Decimal (`decimal.js`, precisión 40):
   - Mediana: el promedio de los dos centrales con n par.
   - MAD: la mediana de |xᵢ − mediana|.
   - Puntaje robusto: z = 0.6745 × (x − mediana) / MAD (Iglewicz y Hoaglin). Solo se calcula con MAD > 0.
   - Percentil por rango más cercano: el valor de la posición ⌈p/100 × n⌉ en orden ascendente.
   - Marca por categoría o contraparte: z ≥ `FORECASTING_ANOMALY_ROBUST_Z` (3.5) **y** x ≥ `FORECASTING_ANOMALY_MIN_RATIO` (3.0) × mediana. Con MAD = 0 alcanza la razón. Pedir las dos condiciones baja los falsos positivos de categorías muy estables, donde z se dispara con poco.
   - Historia mínima: `FORECASTING_ANOMALY_MIN_SAMPLE` (8) por categoría, por contraparte y para el percentil del workspace.
   - Contraparte nueva: sin gastos con esa contraparte en los 365 días anteriores y x ≥ percentil `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` (95) de todos los gastos del workspace en esa ventana.
   - Ventana de historia: los 365 días anteriores a la fecha del gasto, sin el gasto mismo.
   - Mostrar: la razón x / mediana con 1 decimal HALF_EVEN; la mediana y el percentil a la escala de la moneda de reporte con HALF_EVEN.
   *Alternativa descartada:* z-score clásico (media y desvío). Un solo atípico infla el desvío y esconde a los demás; la mediana y el MAD no se mueven.

5. **Granularidad.** La categoría se evalúa por porción (un gasto con dos porciones puede ser atípico en una sola). La contraparte y la contraparte nueva se evalúan por el monto total del gasto. El resultado es **un** gasto atípico por transacción y versión, con un arreglo de motivos `CATEGORY_OUTLIER`, `COUNTERPARTY_OUTLIER` y `NEW_COUNTERPARTY_HIGH_AMOUNT`.

6. **Trabajo diario dentro de `forecasting.schedule`.**
   - `registerForecastingJobs` registra `forecasting.schedule` si `FORECASTING_ENABLED` **o** `FORECASTING_ANOMALIES_ENABLED` (por omisión `true`) está activo. `forecasting.runner` sigue registrándose solo con los pronósticos habilitados.
   - El trabajo hace dos pasos independientes. Primero, si los pronósticos están habilitados, programa corridas y aplica la retención, como hoy. Después, si la detección está habilitada, corre `DetectSpendingAnomalies` por workspace, cada uno en su unidad de trabajo, sin consultas en paralelo sobre el mismo cliente. La falla de un paso o de un workspace se registra y no corta lo demás.
   - Para cada workspace la detección carga la historia una sola vez: las porciones desde hoy − 7 − 365 días hasta hoy, que en el Large Seed son unas 20 000 por año. Evalúa los gastos de los últimos `FORECASTING_ANOMALY_LOOKBACK_DAYS` (7) días cuya versión vigente no tiene evaluación. Cada gasto se compara con su propia ventana de 365 días.
   - Para no reevaluar, se registra la versión evaluada en `forecasting.spending_anomaly_scan` (workspace, transacción, versión y fecha), que se purga a los 30 días. *Alternativa descartada:* guardar solo los atípicos. Obligaría a reevaluar los 7 días completos todos los días y haría imposible saber si una edición ya se evaluó.
   - El cron no cambia (`FORECASTING_SCHEDULE_CRON`); `off` apaga los dos pasos.
   - Con esto, el presupuesto de conexiones no cambia: 28 consumidores + 4 reservadas = 32 de 34 (TC-PLATFORM-THROUGHPUT-009).

7. **Cambios de la transacción.** Una versión nueva de un gasto dentro de la ventana se evalúa otra vez; si había un gasto atípico de otra versión queda `SUPERSEDED`, y si la versión nueva sigue siendo atípica nace uno nuevo. Al leer, la consulta pide a TRANSACTIONS el estado y la versión de las transacciones de la página (`ClassificationSubjectsQuery.byIds` o la query nueva). Las anuladas no se devuelven y las editadas fuera de la ventana llevan `transactionChanged = true`.

8. **Estados.** `OPEN`, `DISMISSED` y `SUPERSEDED`, con unicidad `(workspace_id, transaction_id, transaction_version)`. Descartar o restaurar repetido es inocuo y responde 204 sin cambios ni auditoría nueva. *Alternativa descartada:* 409 al repetir, como en las sugerencias de reglas. Aquí no hay datos que perder y el botón de la marca puede llegar dos veces.

9. **Aviso.** Hecho `SpendingAnomaliesDetectedFact {passDate, count, top {anomalyId, transactionDate, reportingAmount, reasons}, timeZone}` en `NotificationIntakePort`, en la misma unidad de trabajo que inserta los gastos atípicos. `factKey` = `spending-anomalies:{passDate}`: una notificación por pasada y destinatario, para OWNER y EDITOR activos. El tipo `SPENDING_ANOMALY` es el primero **desactivado por omisión** en los dos canales: el catálogo de tipos de NOTIFICATIONS gana un valor por omisión por tipo, y los tipos existentes quedan activos. Severidad `INFO`. Enlace `NotificationLink.kind = SPENDING_ANOMALIES` a `/gastos-atipicos`. *Alternativa descartada:* una notificación por gasto. El primer día con historia cargada podría generar decenas.

10. **Marca en la transacción.** Sin cambios en los contratos de transacciones: la web pide `GET …/spending-anomalies?transactionId=…` (hasta 100 ids) para las filas visibles del listado y para el detalle, y muestra la marca. TRANSACTIONS no lee FORECAST, así que no hay ciclo (FORECAST → TRANSACTIONS ya existe).

11. **Evaluación con el Large Seed (D483).** `pnpm forecast:anomalies:backtest -- --workspace <id> --labels <ruta.jsonl>` (runner de `interface`, sin persistir): recorre toda la historia del workspace en orden de fecha, evalúa cada gasto con sus 365 días anteriores y compara con las etiquetas exportadas por `--labels-out` del seed. Positivos esperados: `OUTLIER` y `NEW_COUNTERPARTY_FRAUD`. Los marcados con otras etiquetas (`DUPLICATE_CHARGE`, `SUBSCRIPTION_PRICE_HIKE`, `P2P_RATE_JUMP`) no cuentan en la precisión. Informa precisión y recall con 4 decimales, conteos por criterio y por etiqueta, y sale con código distinto de cero bajo los umbrales. El nightly suma una fila bloqueante con el Large Seed que ya carga. El informe no lleva montos ni descripciones.

12. **Retención y portabilidad.** Los gastos atípicos se purgan cuando su transacción tiene fecha de hace más de 25 meses (dos años más el periodo en curso), en el paso de mantenimiento del trabajo con el rol de mantenimiento. No viajan en el export, igual que los pronósticos: se recalculan, y los descartes pierden sentido porque la importación crea transacciones con ids nuevos.

13. **Permisos y auditoría.** La lista queda para VIEWER o más; descartar y restaurar, para EDITOR o más. Auditoría de entidad `SpendingAnomaly` (acción `DISMISS`/`RESTORE`, valor anterior y nuevo, motivo). La detección es del sistema y no se audita fila por fila: la cubren las métricas `forecast_anomaly_evaluated_total`, `forecast_anomaly_flagged_total{reason}`, `forecast_anomaly_decided_total{decision}` y `forecast_anomaly_pass_duration_seconds`, sin montos ni ids.

14. **UI.** Ruta `/gastos-atipicos` (menú junto a Pronósticos) con filtros de estado y rango, tabla accesible, motivos por plantilla («3,8 veces la mediana de Restaurantes: 80,00 Bs en los últimos 12 meses, 12 gastos») y botones «No es atípico» y «Restaurar». La marca va en el listado y el detalle de transacciones. Las preferencias de notificaciones muestran el tipo nuevo apagado. Todo con i18n es/en/pt. Ningún texto habla de error ni de fraude (RISK-015).

## Contratos

**`contracts/openapi/finance-api.v1.yaml` (aditivo; oasdiff limpio, Spectral y Redocly sin errores):**

- `GET /workspaces/{workspaceId}/spending-anomalies` (`listSpendingAnomalies`, tag `Forecasting`, `x-openspec-capability: [forecast/anomaly-detection]`, `x-required-role: VIEWER`). Parámetros:
  - `status`: `OPEN` (por omisión), `DISMISSED` o `ALL`.
  - `from` y `to`: fechas de la transacción, inclusivas.
  - `transactionId`: repetible, hasta 100; con este parámetro el resto de los filtros se ignora y se devuelven todos los estados salvo `SUPERSEDED`.
  - `limit` (1–100, por omisión 50) y `cursor`.
  Respuesta 200 `SpendingAnomalyPage {featureStatus: ENABLED|DISABLED, items: SpendingAnomaly[], nextCursor: string|null}`. Errores: 400 `INVALID_FILTER` e `INVALID_CURSOR`, 401, 403, 404 (workspace), 429 y 500.
- `POST /workspaces/{workspaceId}/spending-anomalies/{anomalyId}/dismiss` (`dismissSpendingAnomaly`, `x-required-role: EDITOR`, `Idempotency-Key`). Cuerpo opcional `SpendingAnomalyDismissInput {reason?: EXPECTED_ONE_OFF|NOT_UNUSUAL|OTHER, note?: string ≤ 200}`. Respuesta 204. Errores: 400 `VALIDATION_FAILED`, 403, 404 `RESOURCE_NOT_FOUND` (también si es de otro workspace o está `SUPERSEDED`), 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS` y 422 `IDEMPOTENCY_KEY_REUSED`.
- `POST /workspaces/{workspaceId}/spending-anomalies/{anomalyId}/restore` (`restoreSpendingAnomaly`, `x-required-role: EDITOR`, `Idempotency-Key`). Respuesta 204, con los mismos errores.
- Esquemas:
  - `SpendingAnomaly {id, transactionId, transactionVersion, transactionDate, transactionChanged: boolean, amount: Money, reportingAmount: Money, categoryIds: Uuid[], counterpartyId: Uuid|null, reasons: SpendingAnomalyReason[] (minItems 1), status: OPEN|DISMISSED, detectedAt, decidedAt|null, decidedBy|null, dismissReason|null}`.
  - `SpendingAnomalyReason {kind: CATEGORY_OUTLIER|COUNTERPARTY_OUTLIER|NEW_COUNTERPARTY_HIGH_AMOUNT (x-extensible-enum), categoryId|null, counterpartyId|null, reference: Money (mediana o percentil), ratio: string|null (decimal con 1 decimal), robustScore: string|null (2 decimales), sampleSize: integer}`.
  - Los montos y las razones van como strings decimales.
- `NotificationType` suma `SPENDING_ANOMALY`. `NotificationLink.kind` suma `SPENDING_ANOMALIES`; en ese tipo `periodId` es el id del workspace y `periodLabel` la fecha de la pasada.
- Sin códigos de error nuevos en `ErrorCode`.

**Contratos internos (TypeScript, aditivos):**
- `@pf/transactions/contracts`: `ExpenseLineQuery`, `ExpenseLineDto` y `EXPENSE_LINE_QUERY` (decisión 2).
- `@pf/notifications/contracts`: `SpendingAnomaliesDetectedFact` en la unión `NotificationIntakeFact` y el valor por omisión por tipo en el catálogo.
- `@pf/forecasting/contracts`: `FORECAST_ANOMALY_BACKTEST` (nombre del runner) y los nombres de las métricas.

**Eventos:** ninguno. La detección no publica `forecasting.AnomalyDetected.v1` (docs/15 §12): sin consumidores, sería solo outbox (D249), y la notificación va por el puerto en proceso.

**Base de datos (migración expand, timestamp posterior a la última de `main`):**
- `forecasting.spending_anomaly`: `id uuid pk`, `workspace_id`, `transaction_id`, `transaction_version int`, `transaction_date date`, `amount numeric`, `currency`, `reporting_amount numeric`, `reporting_currency`, `category_ids uuid[]`, `counterparty_id`, `reasons jsonb`, `status text check (OPEN|DISMISSED|SUPERSEDED)`, `dismiss_reason`, `dismiss_note`, `detected_at`, `decided_at`, `decided_by` y `version`. Lleva `unique (workspace_id, transaction_id, transaction_version)` e índices `(workspace_id, status, transaction_date desc)` y `(workspace_id, transaction_id)`.
- `forecasting.spending_anomaly_scan`: `workspace_id`, `transaction_id`, `transaction_version` y `evaluated_at`, con pk de los tres primeros.
- Las dos tienen RLS forzada con la forma vigente de las políticas (D298), están registradas en `platform.workspace_scoped_table` y dan permisos de purga al rol de mantenimiento.

**Configuración (worker; `docs/config-reference.md` y `pnpm config:docs:check`):**

| Variable | Omisión |
|---|---|
| `FORECASTING_ANOMALIES_ENABLED` | `true` |
| `FORECASTING_ANOMALY_LOOKBACK_DAYS` | `7` |
| `FORECASTING_ANOMALY_ROBUST_Z` | `3.5` |
| `FORECASTING_ANOMALY_MIN_RATIO` | `3.0` |
| `FORECASTING_ANOMALY_MIN_SAMPLE` | `8` |
| `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` | `95` |

La API lee `FORECASTING_ANOMALIES_ENABLED` para `featureStatus`.

## Riesgos / Trade-offs

- [Falsos positivos en categorías con montos muy dispares (Regalos, Salud)] → doble condición (z y razón), mínimo de 8 gastos, descarte en un clic y tasa de descarte como dato (D483).
- [Primer trabajo con historia importada] → solo evalúa 7 días; el aviso es uno por pasada y está apagado por omisión.
- [Costo de cargar 365 días por workspace cada día] → una lectura por keyset por workspace; benchmark ≤ 10 s con el Large Seed (TC-FORECAST-ANOMALY-026); si crece, se puede guardar la historia agregada por categoría en una tabla de estadísticas (no hace falta hoy).
- [`forecasting.schedule` registrado con los pronósticos deshabilitados] → el paso de pronósticos sigue condicionado a `FORECASTING_ENABLED`; test del registro con las cuatro combinaciones.
- [Recall bajo en contraparte nueva cuando el import no reconoce la contraparte] → sin contraparte no se evalúa ese criterio; el nightly lo mide por criterio.

## Plan de migración

Migración expand sin datos. Deploy: el worker registra `forecasting.schedule` aunque los pronósticos estén apagados. Rollback: `FORECASTING_ANOMALIES_ENABLED=false` (el trabajo deja de registrarse si los pronósticos también están apagados); las tablas quedan sin uso.

## Cambios a docs compartidos (al implementar)

- **docs/01:** as-built de FR-FORECAST-010; FR-NOTIFY-004 suma el tipo gasto atípico (Phase 9).
- **docs/05 §2.15 y docs/06:** FORECAST lee `ExpenseLineQuery` de TRANSACTIONS; NOTIFICATIONS recibe el hecho nuevo en proceso.
- **docs/10:** endpoints nuevos. **docs/11:** sin eventos nuevos (nota sobre `AnomalyDetected`). **docs/15 §12:** as-built del enfoque MAD y de la mejora con Isolation Forest.
- **docs/17 y la matriz de trazabilidad:** TC nuevos. **docs/23 y nightly:** fila del backtesting.
- **docs/25:** US-246 implementada y US-247 cubierta (D475). **docs/38:** estado del change.
- **docs/config-reference.md:** las seis variables.

## Preguntas abiertas

Ninguna bloqueante. D473, D474, D475 y D483 fijan el método, el aviso, el alcance y el criterio de salida. Los parámetros (3.5, 3.0, 8, 95, 7 días) son configurables y se revisan con el resultado del nightly y con la tasa de descarte del owner al cerrar el criterio de salida con su historia real.
