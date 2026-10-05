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

1. **Fecha de corte = último día calendario del mes** en la zona horaria del workspace (coherente con el bloqueo mensual por `year_month`, D10); el mes en curso usa hoy (`partial: true`). Si el workspace usa `fiscal_month_start_day ≠ 1`, la serie sigue en meses calendario (pregunta abierta 1).
2. **Saldo a la fecha** = Σ postings de la cuenta con `entry_date ≤ corte` (fecha de negocio, decisión 1 de `add-transaction-recording`), incluidas reversas: una corrección posterior fechada en el pasado cambia los puntos pasados abiertos (correcto: la serie refleja el ledger vigente), salvo meses cerrados (decisión 4).
3. **Valoración** con `ValuationRateSelector` de FX en la fecha de corte y `windowDays` del setting `REPORTING_RATE_VALIDITY_WINDOW` (D53), mismos niveles que el patrimonio actual (`PRIMARY → FALLBACK → LAST_KNOWN_STALE/MANUAL`, D34/D38) pero **evaluados a esa fecha** (solo tasas con vigencia ≤ corte). Sin tasa ⇒ punto incompleto (`complete: false`, `unconverted[]`), nunca 1:1.
4. **Meses cerrados**: si `ClosingSnapshotQuery` (pf-p2a, `planning/month-closing`) devuelve un snapshot vigente para el mes con patrimonio en la moneda de reporte pedida, el punto usa sus valores (`source: SNAPSHOT`, `closed: true`); si la moneda de reporte pedida difiere de la del snapshot, se calcula (`COMPUTED`) y se marca `closed: true` con aviso. Mientras pf-p2a no esté aplicado, el puerto devuelve vacío (todo `COMPUTED`).
5. **Cuentas por fecha**: entran las cuentas con `includeInNetWorth = true` (valor vigente; no hay historia del flag, pregunta abierta 2) cuyo saldo a la fecha sea ≠ 0 o que existían a esa fecha (`opened_on ≤ corte`); el estado actual (`ARCHIVED`/`CLOSED`) no excluye fechas pasadas.
6. **Variación** = neto(n) − neto(n−1) en la moneda de reporte; `comparable: false` si alguno es incompleto.
7. **Rango**: por defecto 12 meses terminando en el actual; máximo 120; `from ≤ to ≤ mes actual`.
8. **Caché**: `ETag` = hash(versión de datos del workspace, rango, moneda, setting de ventana, último instante de tasas usado); `304` con `If-None-Match`.
9. **Rendimiento**: saldos as-of en lote para todas las fechas en una consulta por cuenta usando `balance_snapshot`; tasas resueltas en lote por (par, fecha). Objetivo p95 ≤ 800 ms con 24 meses y dataset `large`.

### Contrato

`getNetWorthHistory` — `GET W/reports/net-worth/history?from=2026-01&to=2026-03&reportingCurrency=BOB` (VIEWER) ⇒ `NetWorthHistory { reportingCurrency, points: NetWorthPoint[], meta { ratesUsed[], attributions[], rateWindowDays, dataFreshness } }`; `NetWorthPoint { month, asOf (fecha), assets, liabilities, netWorth (DecimalString), change|null, comparable, complete, unconverted[{ currency, amount }], source: COMPUTED|SNAPSHOT, closed, partial }`.

## Riesgos / Trade-offs

- **Coste de cálculo** sin read models: acotado por `balance_snapshot` y por el máximo de 120 meses; si no alcanza, se adelanta `reporting.net_worth_snapshot` (docs/14) como caché reconstruible.
- **Inconsistencia percibida** entre un mes cerrado (snapshot) y el recálculo con tasas nuevas: se resuelve mostrando siempre el snapshot y marcándolo.

## Plan de migración

Sin migraciones. Contrato: operación nueva (MINOR). La spec principal `reporting/net-worth` actualiza su `Purpose` al archivar (hoy dice que la evolución llega en fases posteriores).

## Preguntas abiertas

1. **Mes calendario vs mes financiero.** Si el workspace configura un día de inicio de mes ≠ 1 (FR-IDENTITY-005), ¿la serie usa el fin del periodo financiero en lugar del fin de mes calendario? **Recomendación:** seguir la definición de periodo que adopte pf-p2a (`planning/financial-periods`); mientras el bloqueo del ledger sea por mes calendario (D10), usar mes calendario.
2. **Historia de `includeInNetWorth`.** ¿Un cambio del flag debe afectar solo desde la fecha del cambio? **Recomendación:** no en Phase 2 (se aplica el valor vigente a toda la serie y la UI lo advierte); la historia exacta llega con los snapshots de cierre, que congelan el valor.
3. **Ubicación en la UI.** ¿Gráfico en el Home (Q1 "¿cuánto tengo?") o solo en una vista de patrimonio? **Recomendación:** tarjeta compacta en el Home (últimos 6 meses) con enlace a la vista completa (12 meses), aplicando la jerarquía visual de D50.

## Dependencias entre changes

- **Requiere aplicados:** `add-basic-dashboard` (spec `reporting/net-worth`, valuador), `add-ledger-core` (saldos as-of), `add-market-rate-providers` (selector de valoración), `add-accounts-management`.
- **Coordina con pf-p2a** (`planning/month-closing`): consume `ClosingSnapshotQuery` (snapshot vigente por mes con patrimonio por moneda y consolidado) y los eventos de cierre/reapertura para invalidar la caché. Sin pf-p2a funciona en modo solo `COMPUTED`.
- **Lo consume:** nada en Phase 2; Phase 7 (`reporting/financial-reports`, reporte 8 "Net Worth") lo extiende con la descomposición del cambio.
