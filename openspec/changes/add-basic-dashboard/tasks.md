# Tareas

> Requiere aplicados: `add-workspace-identity`, `add-accounts-management`, `add-ledger-core`, `add-classification`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`, `add-market-rate-providers`, `add-api-conventions`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los specs `reporting/dashboard` y `reporting/net-worth` y resolver las preguntas abiertas de design.md (definición de cuenta líquida; la tasa USD/USDT↔BOB ya quedó resuelta: `PARALLEL` del provider, docs/31 D29); verificar con `openspec validate add-basic-dashboard --strict`
- [ ] 1.2 Revisar TC-REPORTING-DASHBOARD-001..007, TC-REPORTING-KPI-001..008 y TC-REPORTING-NETWORTH-001..005 contra los scenarios (cifras a mano, fechas fijas, `FixedClock`); verificar que el chequeo del catálogo los acepta y que todo requirement Must tiene ≥ 1 TC

## 2. DOMAIN (TDD, lógica financiera crítica)

- [ ] 2.1 `KpiCalculator` puro (ingresos, gastos netos de reembolsos, ahorro, tasa de ahorro no definida con ingreso 0, top-N con desempate): escribir antes del código los tests de TC-REPORTING-KPI-001, -002, -004, -005, -006 sobre fixtures de postings
- [ ] 2.2 `ConsolidationService` (agregado por moneda y día, conversión única, redondeo HALF_EVEN solo al presentar, `unconverted`/`complete`): tests TDD de TC-REPORTING-KPI-003, TC-REPORTING-DASHBOARD-002, -003, -004 y -007 (selección `PARALLEL` del provider, respaldo, última conocida obsoleta, manual más reciente; con dobles del `RateResolver`)
- [ ] 2.3 `PeriodComparator` (mes calendario en TZ del workspace, comparación a la fecha con acotamiento de N, "nuevo"): tests TDD de TC-REPORTING-KPI-007 y TC-REPORTING-KPI-008
- [ ] 2.4 `NetWorthValuator` (activos − pasivos, inclusión, desglose por moneda/tipo, incompleto): tests TDD de TC-REPORTING-NETWORTH-001..004 y PBT de TC-REPORTING-NETWORTH-005 (transferencias neutras; conversión reduce exactamente fee + spread a tasa de referencia)

## 3. APPLICATION

- [ ] 3.1 `GetReportSummary` orquestando `BalanceQuery`, `NominalFlowQuery`, `AccountCatalog`, `CategoryCatalog`, `RateResolver` y `Clock`; disponibilidad de preguntas Q1..Q9 (TC-REPORTING-DASHBOARD-005); tests de aplicación con dobles de puertos
- [ ] 3.2 Coordinar con Transactions la query pública `SummarizeNominalFlows` (y con Ledger `GetBalances` por lote) en sus módulos `contracts`; verificar con tests de contrato entre módulos y dependency-cruiser (sin imports de internals)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand de `reporting.workspace_data_version` con RLS/DRV e índice de lectura sobre `ledger.posting`; consumidor idempotente (`platform.inbox`) de los eventos listados; test de integración con Testcontainers (evento duplicado no incrementa dos veces)
- [ ] 4.2 Adapters a los contratos de Ledger, Transactions, Accounts, Classification y FX; test de integración end-to-end con PG real verificando TC-REPORTING-DASHBOARD-001 y aislamiento entre dos workspaces

## 5. API

- [ ] 5.1 `GET /reports/summary` con los cambios de §Contratos (compare, ETag/304, `ReportSummary` ampliado); tests de API con TC-REPORTING-DASHBOARD-006 (lectura inmediata tras POST) y de contrato contra el OpenAPI consolidado
- [ ] 5.2 Benchmark nightly con seed `large`: p95 ≤ 300 ms (NFR-PERF-004)

## 6. UI

- [ ] 6.1 Home: `LiquidBalanceCard` (por moneda + consolidado con tasa, `RateSourceBadge` "Fuente: paralelo.bo" con enlace y CC BY 4.0, vigencia, antigüedad e indicador de tasa obsoleta; advertencia de no convertibles), tarjetas de ingresos/gastos/ahorro con variación MoM (semántica `expense-up`, no solo color), `TopCategoriesWidget`, `NetWorthCard` con desglose; textos en español vía i18n y formato `es-BO`
- [ ] 6.2 Widgets de Q4, Q5, Q8 y Q9 en estado "no disponible aún" con acción sugerida; estados vacíos sin cuentas; skeletons < 1 s; verificar con tests de componentes

## 7. TESTS automatizados y E2E

- [ ] 7.1 Golden test del resumen sobre la seed `minimal` (cifras a mano) y agregar TC-REPORTING-KPI-001..003 a la Financial Regression Suite
- [ ] 7.2 E2E Playwright: registrar salario 8000.00 BOB, gastos, un reembolso y la conversión canónica; verificar en el Home ingresos 8000.00 BOB, gastos netos, ahorro, tasa de ahorro y dinero disponible con la tasa USDT/BOB `PARALLEL` del provider simulado (12.02) y su atribución; repetir con providers caídos (tasa marcada obsoleta); viewport móvil incluido

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/14 (§9.1 alineado con docs/00 §6; Phase 1 sin proyecciones), docs/10 (`/reports/summary`) y docs/01 (ubicación de FR-REPORTING-004 en el Home); verificar enlaces
- [ ] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict`; verificar 0 requirements Must sin cobertura
