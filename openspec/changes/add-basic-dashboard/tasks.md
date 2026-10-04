# Tareas

> Requiere aplicados: `add-workspace-identity`, `add-accounts-management`, `add-ledger-core`, `add-classification`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`, `add-market-rate-providers`, `add-api-conventions`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los specs `reporting/dashboard` y `reporting/net-worth` y resolver las preguntas abiertas de design.md (la definición de cuenta líquida quedó resuelta: `ASSET` + `LIQUID`, cuentas no archivadas incluidas, docs/31 D35; la tasa USD/USDT↔BOB ya quedó resuelta: `PARALLEL` del provider, docs/31 D29; el último recurso con manuales de cualquier tipo, docs/31 D34); verificar con `openspec validate add-basic-dashboard --strict`
  > Revisado 2026-10-04 (sigue pendiente del owner): cuenta líquida (D35), tasa USD/USDT (D29), último recurso (D34/D38) y lista de preguntas del Home (D14) resueltas. Siguen abiertas: ubicación de FR-REPORTING-004 en docs/01 (se dejó una nota aclaratoria, sin mover la FR) y `/reports/summary` vs `/reports/kpis` en Phase 7.
- [x] 1.2 Revisar TC-REPORTING-DASHBOARD-001..007, TC-REPORTING-KPI-001..008 y TC-REPORTING-NETWORTH-001..005 contra los scenarios (cifras a mano, fechas fijas, `FixedClock`); verificar que el chequeo del catálogo los acepta y que todo requirement Must tiene ≥ 1 TC
  - Nota (2026-10-03): cifras verificadas a mano contra los scenarios; el chequeo de catálogo los acepta y todo Must tiene ≥ 1 TC. TC-REPORTING-DASHBOARD-007: la variante manual se automatizó como `PARALLEL` (ver design.md § Preguntas abiertas). La revisión con el owner sigue en 1.1.

- [ ] 1.3 Decisiones del owner 2026-10-03 (docs/31 D34, D35): spec ampliada (scenarios "Cuenta cerrada incluida y archivada excluida", "Tasa manual de otro tipo no fresca descartada" y "Tasa manual de otro tipo con desvío excesivo descartada") y TC-REPORTING-DASHBOARD-008/-009 redactados (draft)
  - [ ] 1.3.1 Verificar (test de API) que el resumen lista cuentas `CLOSED` no archivadas (TC-REPORTING-DASHBOARD-008); la regla ya está implementada (decisión 12), falta el test con el TC-id
    > Verificado 2026-10-04 (pendiente, código): no hay test `[TC-REPORTING-DASHBOARD-008]` (el TC sigue `draft`).
  - [ ] 1.3.2 Cuando FX implemente D34 en `ValuationRateSelector` (coordinado con `add-market-rate-providers`; este change no toca `packages/contexts/fx`), automatizar TC-REPORTING-DASHBOARD-009 y re-automatizar la variante manual de TC-REPORTING-DASHBOARD-007 con `P2P`
    > Verificado 2026-10-04 (desbloqueado, pendiente de código): FX ya implementa D34/D38 en `packages/contexts/fx/src/domain/valuation-rate-selector.ts` (`[TC-FX-PROVIDER-018]`, `FX_MANUAL_FALLBACK_MAX_AGE` 24 h). Falta el test `[TC-REPORTING-DASHBOARD-009]` y rehacer la variante manual de DASHBOARD-007 con `P2P` (hoy `PARALLEL` en `reports.api.test.ts`).
  - [x] 1.3.3 Confirmar con el owner el máximo de frescura de manuales en el último recurso (propuesta 24 h, `FX_MANUAL_FALLBACK_MAX_AGE`)
    - Nota (2026-10-04): confirmado 24 h por el owner (docs/31 D38); es el default vigente, sin cambios de código.

## 2. DOMAIN (TDD, lógica financiera crítica)

- [x] 2.1 `KpiCalculator` puro (ingresos, gastos netos de reembolsos, ahorro, tasa de ahorro no definida con ingreso 0, top-N con desempate): escribir antes del código los tests de TC-REPORTING-KPI-001, -002, -004, -005, -006 sobre fixtures de postings
- [x] 2.2 `ConsolidationService` (agregado por moneda y día, conversión única, redondeo HALF_EVEN solo al presentar, `unconverted`/`complete`): tests TDD de TC-REPORTING-KPI-003, TC-REPORTING-DASHBOARD-002, -003, -004 y -007 (selección `PARALLEL` del provider, respaldo, última conocida obsoleta, manual más reciente; con dobles del `RateResolver`)
  - Nota: `ConsolidationService` + `convertExact`/`present` (dominio); la selección de nivel (PRIMARY/LAST_KNOWN_STALE/MANUAL) se prueba con dobles del puerto de FX en aplicación y con FX real + PG en `apps/api/test/api/reports.api.test.ts`.
- [x] 2.3 `PeriodComparator` (mes calendario en TZ del workspace, comparación a la fecha con acotamiento de N, "nuevo"): tests TDD de TC-REPORTING-KPI-007 y TC-REPORTING-KPI-008
- [x] 2.4 `NetWorthValuator` (activos − pasivos, inclusión, desglose por moneda/tipo, incompleto): tests TDD de TC-REPORTING-NETWORTH-001..004 y PBT de TC-REPORTING-NETWORTH-005 (transferencias neutras; conversión reduce exactamente fee + spread a tasa de referencia)

## 3. APPLICATION

- [x] 3.1 `GetReportSummary` orquestando `BalanceQuery`, `NominalFlowQuery`, `AccountCatalog`, `CategoryCatalog`, `RateResolver` y `Clock`; disponibilidad de preguntas Q1..Q9 (TC-REPORTING-DASHBOARD-005); tests de aplicación con dobles de puertos
- [x] 3.2 Coordinar con Transactions la query pública `SummarizeNominalFlows` (y con Ledger `GetBalances` por lote) en sus módulos `contracts`; verificar con tests de contrato entre módulos y dependency-cruiser (sin imports de internals)
  - Nota: contratos nuevos `AccountBalancesQuery` (ledger), `NominalFlowQuery` (transactions), `AccountCatalogQuery` (accounts), `CategoryCatalogQuery` (classification) y `FxValuationPort` (fx); verificados end-to-end por el test de API y por `pnpm arch:check`.

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand de `reporting.workspace_data_version` con RLS/DRV e índice de lectura sobre `ledger.posting`; consumidor idempotente (`platform.inbox`) de los eventos listados; test de integración con Testcontainers (evento duplicado no incrementa dos veces)
  - Nota: migración `20261004120000_reporting_workspace_data_version.sql`; el índice de `ledger.posting` ya existía (`posting_balance_ix`). Consumidor `reporting.data-version` en el worker; el duplicado se prueba en `reports.api.test.ts`.
- [x] 4.2 Adapters a los contratos de Ledger, Transactions, Accounts, Classification y FX; test de integración end-to-end con PG real verificando TC-REPORTING-DASHBOARD-001 y aislamiento entre dos workspaces
  - Nota: aislamiento verificado (otro workspace no ve cuentas/flujos y no puede leer el resumen ajeno).

## 5. API

- [x] 5.1 `GET /reports/summary` con los cambios de §Contratos (compare, ETag/304, `ReportSummary` ampliado); tests de API con TC-REPORTING-DASHBOARD-006 (lectura inmediata tras POST) y de contrato contra el OpenAPI consolidado
  - Nota: el contrato ya estaba consolidado; solo se agregó `ResolvedRate.sourceLabel` (aditivo, oasdiff sin cambios incompatibles). Respuestas validadas contra el OpenAPI en el test de API.
- [ ] 5.2 Benchmark nightly con seed `large`: p95 ≤ 300 ms (NFR-PERF-004)
  > Verificado 2026-10-04 (pendiente, benchmark): no hay workflow nightly ni benchmark, y el perfil de seed `large` aún no tiene datos (`apps/api/src/seed/run-seed.ts`).
  - Pendiente (2026-10-03): la seed `large` aún no existe (docs/29); sin benchmark.

## 6. UI

- [x] 6.1 Home: `LiquidBalanceCard` (por moneda + consolidado con tasa, `RateSourceBadge` "Fuente: paralelo.bo" con enlace y CC BY 4.0, vigencia, antigüedad e indicador de tasa obsoleta; advertencia de no convertibles), tarjetas de ingresos/gastos/ahorro con variación MoM (semántica `expense-up`, no solo color), `TopCategoriesWidget`, `NetWorthCard` con desglose; textos en español vía i18n y formato `es-BO`
  - Nota: `apps/web/src/ui/dashboard/*`; acciones "crear cuenta"/"registrar tasa" como texto (aún no hay páginas de cuentas ni tasas en la web).
  - Nota (2026-10-03): las acciones "Crea tu primera cuenta" y "Registrar tasa X/BOB" ya son enlaces reales (`/cuentas/nueva` y `/fx?base=X&quote=BOB`).
- [x] 6.2 Widgets de Q4, Q5, Q8 y Q9 en estado "no disponible aún" con acción sugerida; estados vacíos sin cuentas; skeletons < 1 s; verificar con tests de componentes

## 7. TESTS automatizados y E2E

- [x] 7.1 Golden test del resumen sobre la seed `minimal` (cifras a mano) y agregar TC-REPORTING-KPI-001..003 a la Financial Regression Suite
  - Nota: la Minimal Seed aún no tiene datos financieros (solo identidades); el golden se hizo sobre el escenario canónico de los TC (`report-summary.golden.test.ts`, cifras a mano). TC-REPORTING-KPI-001..003 ya tenían `regression_suite: true`.
- [x] 7.2 E2E Playwright: registrar salario 8000.00 BOB, gastos, un reembolso y la conversión canónica; verificar en el Home ingresos 8000.00 BOB, gastos netos, ahorro, tasa de ahorro y dinero disponible con la tasa USDT/BOB `PARALLEL` del provider simulado (12.02) y su atribución; repetir con providers caídos (tasa marcada obsoleta); viewport móvil incluido
  - Nota: `tests/e2e/specs/dashboard.spec.ts` (stack `pfos-e2e`, `FX_PROVIDER_* = none`, sin red): la tasa del provider simulado se registra como fila `PROVIDER`/`PARALELO_BO` del workspace; primero obsoleta (hace 3 h, "obsoleta"), luego fresca. Escenario: banco 1000.00 + salario, gastos, reembolso y conversión ⇒ disponible 8986.00 BOB.

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/14 (§9.1 alineado con docs/00 §6; Phase 1 sin proyecciones), docs/10 (`/reports/summary`) y docs/01 (ubicación de FR-REPORTING-004 en el Home); verificar enlaces
- [x] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict`; verificar 0 requirements Must sin cobertura
  - Nota: TC de reporting marcados `automated`, matriz regenerada, `openspec validate --all --strict` y `traceability:check` en verde. 8.1 (docs/14, docs/10, docs/01) queda pendiente.
