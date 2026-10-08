# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: FR-REPORTING-006, docs/14 §4 (`NW(d) = Σ conv_v(balance_a(d), d)`, stocks valorados a la fecha de valoración: "fin de mes para histórico"), §2 (`reporting.net_worth_snapshot` y `daily_balance` como read models futuros), docs/31 D15 (Phase 1 sin read models), D35 (cuentas no archivadas en el resumen actual), D53 (ventana de vigencia = setting de REPORTING, pasado como `windowDays` a FX), D55 (`/reports/kpis` en Phase 7; este endpoint es independiente). Capability existente `reporting/net-worth` (Phase 1, `add-basic-dashboard`).

| Capa | Cambios |
|---|---|
| domain | `NetWorthSeriesBuilder` puro: recibe fechas de corte, saldos por cuenta y fecha, metadatos de cuentas, tasas resueltas y snapshots, y devuelve puntos con completitud, fuente y variación. Reutiliza el valuador de Phase 1 (`NetWorthCalculator`). |
| application | Query `GetNetWorthHistory(from, to, reportingCurrency)`. |
| infrastructure | Consulta de saldos as-of en lote (una pasada por cuenta: `balance_snapshot` más cercano ≤ fecha + Σ postings posteriores hasta la fecha, ARCHITECTURE §4/INV-022) vía `LedgerQueryPort`. |
| interface | `GET W/reports/net-worth/history`; UI: gráfico de línea (neto) con barras apiladas (activos/pasivos), marcadores de punto incompleto (hueco + aviso) y cerrado (candado), tooltip con tasas y atribución (ADR-0025). |

## Objetivos / No objetivos

**Objetivos:** serie mensual honesta (sin tasas inventadas), estable para meses cerrados, coherente con el patrimonio actual.

**No objetivos:** descomposición del cambio, granularidad diaria, read models, valoración de activos no monetarios, export del reporte.

## Decisiones

1. **Fecha de corte = fin del periodo financiero** (consolidación 2026-10-05, P-1 resuelta): los puntos son los periodos mensuales de `planning/financial-periods` (`PeriodQuery.listPeriods`), con fecha de corte `periodEnd` (con día de inicio 1, último día del mes calendario) y etiqueta `label` (`YYYY-MM` del inicio); el periodo en curso usa hoy en la TZ del workspace (`partial: true`). Coherente con el bloqueo por rango del periodo financiero (ADR-0028) y con los snapshots de cierre, que congelan el patrimonio a `periodEnd`. Para fechas anteriores al primer periodo existente (antes de cualquier asiento) la serie no tiene puntos. Un periodo de transición (cambio del día de inicio) es un punto más con su propio rango.
2. **Saldo a la fecha** = Σ postings de la cuenta con `entry_date ≤ corte` (fecha de negocio, decisión 1 de `add-transaction-recording`), incluidas reversas: una corrección posterior fechada en el pasado cambia los puntos pasados abiertos (correcto: la serie refleja el ledger vigente), salvo meses cerrados (decisión 4).
3. **Valoración** con `ValuationRateSelector` de FX en la fecha de corte y `windowDays` del setting `REPORTING_RATE_VALIDITY_WINDOW` (D53), mismos niveles que el patrimonio actual (`PRIMARY → FALLBACK → LAST_KNOWN_STALE/MANUAL`, D34/D38) pero **evaluados a esa fecha** (solo tasas con vigencia ≤ corte). Sin tasa ⇒ punto incompleto (`complete: false`, `unconverted[]`), nunca 1:1.
4. **Periodos cerrados**: `ClosingSnapshotQuery.listCurrent({workspaceId, periodIds})` (contrato de `add-month-closing`, §Contratos internos) devuelve el snapshot vigente de cada periodo cerrado con patrimonio, activos y pasivos en la moneda base; si la moneda de reporte pedida es la del snapshot, el punto usa sus valores (`source: SNAPSHOT`, `closed: true`); si difiere, se calcula (`COMPUTED`) y se marca `closed: true` con aviso. En el orden consolidado `add-month-closing` (18) se aplica antes que este change (22).
5. **Cuentas por fecha**: entran las cuentas con `includeInNetWorth = true` (valor vigente; no hay historia del flag; confirmado por el owner, docs/33 D103) cuyo saldo a la fecha sea ≠ 0 o que existían a esa fecha (`opened_on ≤ corte`); el estado actual (`ARCHIVED`/`CLOSED`) no excluye fechas pasadas.
6. **Variación** = neto(n) − neto(n−1) en la moneda de reporte; `comparable: false` si alguno es incompleto.
7. **Rango**: por etiquetas de periodo (`from`/`to` = `YYYY-MM`); por defecto 12 periodos terminando en el actual; máximo 120; `from ≤ to ≤ periodo actual`.
8. **Caché**: `ETag` = hash(versión de datos del workspace, rango, moneda, setting de ventana, último instante de tasas usado); `304` con `If-None-Match`.
9. **Rendimiento**: saldos as-of en lote para todas las fechas en una consulta por cuenta usando `balance_snapshot`; tasas resueltas en lote por (par, fecha). Objetivo p95 ≤ 800 ms con 24 meses y dataset `large`.

### Contrato

`getNetWorthHistory` — `GET W/reports/net-worth/history?from=2026-01&to=2026-03&reportingCurrency=BOB` (VIEWER) ⇒ `NetWorthHistory { reportingCurrency, points: NetWorthPoint[], meta { ratesUsed[], attributions[], rateWindowDays, dataFreshness } }`; `NetWorthPoint { period (label), periodId, asOf (fecha de corte = periodEnd u hoy), assets, liabilities, netWorth (DecimalString), change|null, comparable, complete, unconverted[{ currency, amount }], source: COMPUTED|SNAPSHOT, closed, partial }`.

## Riesgos / Trade-offs

- **Coste de cálculo** sin read models: acotado por `balance_snapshot` y por el máximo de 120 meses; si no alcanza, se adelanta `reporting.net_worth_snapshot` (docs/14) como caché reconstruible.
- **Inconsistencia percibida** entre un mes cerrado (snapshot) y el recálculo con tasas nuevas: se resuelve mostrando siempre el snapshot y marcándolo.

## Plan de migración

Sin migraciones. Contrato: operación nueva (MINOR). La spec principal `reporting/net-worth` actualiza su `Purpose` al archivar (hoy dice que la evolución llega en fases posteriores).

## Preguntas abiertas

**Todas resueltas por el owner el 2026-10-08** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md), decisiones D59–D111); cada pregunta indica su decisión. Se conserva el texto original.

1. **Mes calendario vs mes financiero.** *(Resuelta en la consolidación del 2026-10-05: la serie sigue los periodos financieros de `add-financial-periods` y el bloqueo por rango de ADR-0028; decisión 1.)* **Resuelta** en la consolidación del 2026-10-05 (sin decisión adicional del owner).
2. **Historia de `includeInNetWorth`.** ¿Un cambio del flag debe afectar solo desde la fecha del cambio? **Recomendación:** no en Phase 2 (se aplica el valor vigente a toda la serie y la UI lo advierte); la historia exacta llega con los snapshots de cierre, que congelan el valor. → **Resuelta por el owner (2026-10-08): D103** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
3. **Ubicación en la UI.** ¿Gráfico en el Home (Q1 "¿cuánto tengo?") o solo en una vista de patrimonio? **Recomendación:** tarjeta compacta en el Home (últimos 6 meses) con enlace a la vista completa (12 meses), aplicando la jerarquía visual de D50. → **Resuelta por el owner (2026-10-08): D104** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).

## Dependencias entre changes

- **Requiere aplicados:** `add-basic-dashboard` (spec `reporting/net-worth`, valuador), `add-ledger-core` (saldos as-of), `add-market-rate-providers` (selector de valoración), `add-accounts-management`.
- **Requiere (orden consolidado):** `add-financial-periods` (13; puntos = periodos, `PeriodQuery`) y `add-month-closing` (18; `ClosingSnapshotQuery.listCurrent` y los eventos `planning.MonthClosed.v1`/`PeriodReopened.v1` para invalidar la caché).
- **Lo consume:** nada en Phase 2; Phase 7 (`reporting/financial-reports`, reporte 8 "Net Worth") lo extiende con la descomposición del cambio.
