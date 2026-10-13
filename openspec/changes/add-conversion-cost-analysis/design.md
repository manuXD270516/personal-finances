# Diseño: add-conversion-cost-analysis

## Contexto

`add-manual-conversions` (Phase 1) dejó en TRANSACTIONS el `ConversionDetail` inmutable por revisión (montos, tasa cotizada, efectiva, referencia con su id y tipo, spread, fees con su cuenta, contraparte como `provider {counterpartyId, name}`) y en FX el cálculo del spread y del costo total (`fx/conversion-pricing`). Los eventos `transactions.ConversionRecorded.v1` y `ConversionRevised.v1` ya listan a FX como consumidor previsto ("observación de tasa") y `FxRateSource` ya incluye `USER_CONVERSION` sin uso (D26). El worker está en 33 conexiones de pool y la plantilla del host suma 55 de 60 de Postgres (`deploy/compose/compose.prod.yaml`, `deploy/host/etc-pfos/pfos.env.example`).

Decisiones que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D231 | Por omisión | Cada conversión posteada es una observación `USER_CONVERSION` de su par (tasa efectiva), visible en el historial y usada por el análisis, nunca para valorar. Cierra D26 sin cambiar D29. Requiere un consumidor en FX (D249). |
| D244 | Por omisión | Canal = contraparte + par de cuentas; sin contraparte, "Sin canal"; sin cambios en TRANSACTIONS. |
| D245 | Por omisión | REPORTING compone sobre una consulta pública de TRANSACTIONS sobre `ConversionDetail`; el requisito vive en `fx/conversion-pricing`; el design reevalúa apoyarse en las observaciones. |
| D246 | Por omisión | Promedio ponderado por monto convertido en moneda de reporte; periodo financiero con opción de mes calendario. |
| D247 | Por omisión | Base = tasa de referencia registrada; sin referencia, excluida y contada aparte; recalcular contra compra o venta paralela es Could. |
| D249 | Por omisión | Único consumidor nuevo de la fase; antes se sube `max_connections` y se valida el arranque del worker, en este mismo change. |

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Transactions | `ConversionDetailQuery.listForCostAnalysis({workspaceId, from, to})` → revisión vigente de conversiones posteadas (no anuladas) con fecha de negocio, ejecución, cuentas, contraparte, montos, referencia, spread y fees | application (contracts) | Nuevo, aditivo |
| Reporting | DS puro `ConversionCostAggregator` (agrupa, pondera, excluye, totaliza) | domain | Nuevo (TDD, PBT) |
| Reporting | Query `GetConversionCostAnalysis`, `ExportConversionCostAnalysis` (CSV) | application | Nuevo |
| FX | `RecordUserConversionObservation` (registra, reemplaza, retira), carga inicial `BackfillUserConversionObservations`, exclusión de `USER_CONVERSION` en `RateResolver` | application | Nuevo / ampliado |
| FX | Consumidor `fx.user-conversion-observations` (inbox, concurrencia 1) | interface (worker) | Nuevo |
| Deploy | `max_connections`, `DATABASE_POOL_MAX` del worker | configuración | Cambio |
| apps/api / apps/web | Endpoints y vista "Costo de conversiones" | interface | Nuevo |

## Objetivos / No objetivos

**Objetivos:**
- Comparar el costo real de convertir por canal y periodo con cifras explicables y sin estimaciones.
- Observaciones de las conversiones propias en el historial de tasas sin tocar la valoración.
- Agregar el consumidor sin agotar las conexiones.

**No objetivos:**
- Campo de canal en la conversión, providers de casas de cambio, trades importados, reportes de Phase 7.
- Valorar con las observaciones (D29, D231).

## Decisiones

1. **Fuente del cálculo (reevaluación de D245).** El análisis se calcula sobre `ConversionDetail` vía `ConversionDetailQuery` (TRANSACTIONS) y **no** sobre las observaciones de FX: las observaciones solo tienen par, tasa efectiva e instante; el análisis necesita contraparte, cuentas, fees, referencia y spread por revisión, que viven en `ConversionDetail`. Usar las observaciones obligaría a copiar esos datos a FX (doble verdad). El contrato de lectura no cambia con esta elección (D245).
2. **Canal (D244).** Clave = (`counterpartyId` o, si es nulo y hay nombre libre, el nombre normalizado; o "Sin canal" si no hay ninguno) + cuenta de origen + cuenta de destino. Nombres de contraparte y cuentas por los contratos de CLASSIFICATION y ACCOUNTS (en bloque, sin N+1).
3. **Montos y ponderación (D246, D247).** Por conversión (revisión vigente): `baseQty` = cantidad convertida de la moneda base del par (la vendida o comprada); `converted` = `baseQty × referencia` en la quote del par, valorado a la moneda de reporte con `FlowValuation` a `executedAt` si la quote no es la moneda de reporte; `spreadAmount` = el ya registrado (`|cotizada − referencia| × baseQty`, en la quote) valorado igual; `fees` = Σ fees valorados con la referencia del instante (regla de "Costo total de la conversión"). Grupo: `spreadPct = Σ spreadAmount / Σ converted × 100` (equivale al promedio ponderado por `converted`), `costTotal = Σ spreadAmount + Σ fees`. Todo en Decimal con precisión interna 40; HALF_EVEN solo al presentar (montos a la escala de la moneda de reporte, porcentajes a 4 decimales). Excluidas: sin referencia (`NO_REFERENCE`), sin tasa cotizada (spread no determinable, `NO_QUOTED_RATE`), o sin valoración en moneda de reporte en la ventana (`NO_REPORTING_RATE`); se cuentan por grupo con motivo y monto en su moneda.
4. **Periodo.** `grouping = FINANCIAL_PERIOD` (por defecto; periodos de `planning/financial-periods` por contrato público, con la regla del día de inicio aunque el periodo aún no exista en la tabla) o `CALENDAR_MONTH`; asignación por `businessDate` en la zona del workspace. Rango por `from`/`to` (fechas de negocio), máximo 24 periodos por consulta.
5. **Could: spread contra la paralela del día.** Con `compareWith = PARALLEL_SIDE`, por conversión se resuelve `PARALLEL_BUY` (si compra la base del par) o `PARALLEL_SELL` (si la vende) vigente a `executedAt` con el selector de providers; sin esa tasa, se excluye del alternativo. No toca el spread registrado.
6. **Observaciones (D231).** El consumidor `fx.user-conversion-observations` (inbox por `(consumer, eventId)`, INV-028) suscribe `ConversionRecorded.v1`, `ConversionRevised.v1` y `TransactionVoided.v1` (filtrado a conversiones). Registra en `fx.exchange_rate` una fila `source = USER_CONVERSION`, par en la orientación de visualización, `value` = tasa efectiva registrada (18 decimales), `as_of = executedAt`, `rate_type = CUSTOM` (pregunta 2), `source_label` = "Conversión" y `conversion_transaction_id`/`conversion_revision`; índice único parcial `(workspace_id, conversion_transaction_id, conversion_revision)` para la idempotencia de negocio. Revisión: fila nueva con `supersedes_id` de la anterior y motivo "conversión revisada" (mecanismo de reemplazo de `fx/market-rates`, actor de sistema). Anulación: fila append-only en `fx.rate_withdrawal` (`exchange_rate_id` PK, `workspace_id`, `reason`, `transaction_id`, `withdrawn_at`), sin tocar la tasa (pregunta 3). Emite `fx.RateRecorded.v1` con `source = USER_CONVERSION` (consumidor actual: REPORTING invalida `dataVersion`). Carga inicial: job único idempotente al desplegar que recorre `ConversionDetailQuery` (revisión vigente; las anuladas se registran y se retiran).
7. **Nunca para valorar.** `RateResolver` (`resolve`, `tryResolve`, `resolveForConversion`, cruzadas y fallback manual de otro tipo) excluye `source = USER_CONVERSION` en la consulta (no después). Test de propiedad: añadir observaciones arbitrarias no cambia ninguna valoración (TC-FX-USERCONV-002).
8. **Conexiones (D249).** Primero, en este change y antes de registrar el consumidor: `max_connections` de 60 a 70 en `deploy/compose/compose.prod.yaml` (memoria de Postgres revisada contra su límite de 384 MiB; ver pregunta 4) y `DATABASE_POOL_MAX` del worker de 33 a 34 en `pfos.env.example` (28 consumidores × concurrencia 1 + 4 reservadas = 32, con los 2 de margen), con el comentario de cálculo actualizado; total 34 + 22 = 56 sobre 70. Luego el consumidor con concurrencia 1. El test de arranque del worker (`assertConsumerConnectionBudget`, TC-PLATFORM-EVENTS-018) y TC-PLATFORM-EVENTS-019 lo validan; `docs/38` §4 y docs/19 se actualizan. No cambia la protección de ramas ni los checks requeridos.
9. **Autorización y exportación.** VIEWER+ (lectura); RLS en todas las lecturas. El CSV usa el neutralizador de celdas de la exportación de auditoría y el bucket `costly` (10/min) como las demás exportaciones. Sin auditoría (lecturas).

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (aditivo; `x-openspec-capability: fx/conversion-pricing`):

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `getConversionCostAnalysis` | `GET W/reports/conversion-costs?from&to&grouping&compareWith` | VIEWER | 200 `ConversionCostAnalysis` |
| `exportConversionCostAnalysis` | `GET W/reports/conversion-costs/export?from&to&grouping` | VIEWER | 200 `text/csv`; `x-rate-limit: costly` |

`ConversionCostAnalysis`: `{reportingCurrency, grouping, from, to, groups[{period {label, from, to}, channel {kind: COUNTERPARTY|NAMED|NONE, counterpartyId|null, name|null}, sourceAccountId, targetAccountId, pair {base, quote}, conversions, converted: Money, spreadPct: DecimalString, spreadAmount: Money, fees: Money, costTotal: Money, excluded[{reason: NO_REFERENCE|NO_QUOTED_RATE|NO_REPORTING_RATE, count, amounts: Money[]}], alternative {spreadPct, excludedCount}|null}], totals {converted, spreadAmount, fees, costTotal}, meta {ratesUsed[], rateWindowDays}}`. `FxRate`: `conversionRef {transactionId, revision}|null` y `withdrawn {at, reason}|null` (opcionales). Sin códigos de error nuevos (`VALIDATION_FAILED` para rangos inválidos).

**Eventos:** consume `transactions.ConversionRecorded.v1`, `transactions.ConversionRevised.v1`, `transactions.TransactionVoided.v1` (actualizar descripciones de consumidores y `contracts/events/README.md`); produce `fx.RateRecorded.v1` con `source = USER_CONVERSION` (ya admitido).

**Contratos entre módulos:** `@pf/transactions/contracts` `ConversionDetailQuery` (nuevo).

## Riesgos / Trade-offs

- [Conexiones] → `max_connections` y pool subidos antes del consumidor; test de arranque; el resto del presupuesto queda documentado (docs/38 §4).
- [Conversiones antiguas sin referencia] → se excluyen y se cuentan aparte; nunca se estima.
- [Ruido en el historial de tasas] → las observaciones se distinguen por origen y el historial filtra por origen; no aparecen en la valoración.
- [Rendimiento con muchas conversiones] → una consulta por rango y una resolución de tasas fusionada; objetivo p95 ≤ 800 ms para 12 meses (NFR-PERF-006).

## Plan de migración

1. Configuración de despliegue: `max_connections` 70 y pool del worker 34 (antes del consumidor).
2. Migraciones expand-only: columnas nullables en `fx.exchange_rate` + CHECK `(source = 'USER_CONVERSION') = (conversion_transaction_id IS NOT NULL)` + índice único parcial; `fx.rate_withdrawal` con RLS forzada, grants (`pf_worker` INSERT/SELECT, `pf_app` SELECT) y `platform.workspace_scoped_table`; portabilidad (sección después de las tasas). Timestamps posteriores a la última de `main`.
3. Consumidor y carga inicial. Rollback: desregistrar el consumidor (las observaciones quedan como historial inerte; la valoración nunca las usó).

## Preguntas abiertas

> **Resueltas al implementar (2026-10-13), adoptando las recomendaciones:** 1 → (a) el Could se implementó; 2 → (a) `rateType = CUSTOM` con `source = USER_CONVERSION`; 3 → (a) la anulación se marca en `fx.rate_withdrawal` (append-only) sin tocar la tasa; 4 → (a) `max_connections = 70` y pool del worker 34. Revertibles por el owner (D231, D245–D247, D249).


1. **Prioridad del Could (spread contra la paralela del día).** (a) **Implementarlo en este change si el resto está terminado**; (b) dejarlo para Phase 7. **Recomendación: (a)**; no bloquea.
2. **Tipo de tasa de las observaciones.** `rateType` es obligatorio en la tasa y en `fx.RateRecorded.v1`. Opciones: (a) **`CUSTOM` con `source = USER_CONVERSION`** (sin contrato nuevo; la exclusión es por origen); (b) un tipo nuevo `USER_CONVERSION`/`EFFECTIVE` (aditivo, pero mezcla origen y tipo); (c) el tipo de la referencia de la conversión. **Recomendación: (a)**; no bloquea.
3. **Observación de una conversión anulada.** D231 no lo dice. Opciones: (a) **marcarla como anulada en una tabla append-only, sin tocar la tasa** (este diseño; el consumidor suscribe también `TransactionVoided.v1`); (b) dejarla sin marca; (c) reemplazarla. **Recomendación: (a)**; confirmar antes de implementar el grupo 3.
4. **Valor de `max_connections`.** D249 pide subirlo sin fijar el valor. Opciones: (a) **70** (margen de 14 sobre 56 para superusuario, migraciones, backup y `pf_bff`); (b) 80; (c) agrupar consumidores de concurrencia 1 en vez de subir. **Recomendación: (a)**, validando la memoria de Postgres con el límite de 384 MiB del contenedor; no bloquea la spec.
