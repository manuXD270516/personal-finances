# @pf/forecasting: bounded context FORECAST

Corridas de pronóstico (openspec `add-ml-forecasting-service`, capability `forecast/expense-forecasting`, Phase 8): historia por
periodo financiero, preparación de datos por serie, ACL del servicio `finance-ml` y degradación sin el servicio. FORECAST **no
escribe en el ledger** ni en tablas de otros contextos, y el núcleo nunca espera al servicio (FR-FORECAST-006).

| Capa             | Contenido                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | AR `ForecastRun` con la máquina `FORECAST_RUN_LIFECYCLE` (reintento con espera 5 min × 3^(n−1), falla al 5.º intento o a las 24 h, corrida colgada a los 15 min); `PeriodSeriesBuilder` (periodos terminados, tasa de cada fecha, sin 1:1), `ReadinessGate` (MODEL ≥ 6, SIMPLE 3–5, INSUFFICIENT; «Otras categorías», huecos, clasificación), `OpaqueRefAllocator`/`ForecastRequestBuilder` y `ForecastResultValidator`. Puro. |
| `application`    | `RequestForecastRun`, `ScheduleForecastRuns` (diario + retención), `ExecuteForecastRun` (por pasos, sin conexión retenida durante la llamada), `ForecastQueries` (vigente, corridas, recorrido; implementa `LatestForecastQuery`). Dobles en `application/testing`.                                                                                                                         |
| `infrastructure` | Repositorios SQL (`forecasting.*`, `FOR UPDATE SKIP LOCKED`), `PgMaintenance` (barrido como `pf_maintenance`), `PgForecastOperations` (`platform.operation`, kind `FORECAST`) y `MlForecastingServiceClient` (fetch con tiempo máximo y respuesta validada).                                                                                                                                  |
| `interface`      | `ForecastingModule` + controlador (`/forecasts*`), `createForecastingRuntime`, `runForecastSchedule` y `runForecastRunner` (jobs del worker).                                                                                                                                                                                                                                              |
| `contracts`      | `LatestForecastQuery` (para el change 66), `FORECAST_SCHEDULE_JOB`, `FORECAST_RUNNER_JOB`, `FORECAST_GENERATED_EVENT`, `FORECASTING_AUDIT_POLICY` y las exclusiones de portabilidad.                                                                                                                                                                                                         |

Dependencias permitidas: contratos de TRANSACTIONS (`NominalFlowQuery`), CLASSIFICATION (`CategoryCatalogQuery`), FX
(`FxValuationPort`), IDENTITY (calendario y moneda base) y AUDIT, más `@pf/shared-kernel` y `@pf/platform`. **No** depende de
REPORTING (REPORTING leerá FORECAST en el change 66) ni consume eventos: los jobs `forecasting.schedule` y `forecasting.runner`
comparten la reserva de trabajos periódicos del worker (D249).

Esquema de BD: `apps/api/db/migrations/20261112100000_forecasting_schema.sql` (`forecast_run`, `forecast_series`,
`forecast_point`; RLS forzada fail-closed y registro en `platform.workspace_scoped_table`).

| Script                  | Efecto                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm test`             | Unitarios, propiedades y aplicación con dobles en memoria (`src/**/*.test.ts`)                   |
| `pnpm test:integration` | Repositorios, RLS y permisos contra PostgreSQL 18 (Testcontainers; requiere Docker). HTTP: `apps/api/test/api/forecasting.api.test.ts` |

## add-expense-forecasts (Phase 8)

Cada punto es la suma exacta de los **conocidos** (`KnownFutureCalculator`, Decimal, en este contexto y nunca en el servicio) y la
parte **variable** que predice el servicio sobre la historia sin lo recurrente resuelto (`VariableHistoryBuilder`).
`ForecastComposer` suma, arma los motivos (el residuo de redondeo cae en `TREND_AND_LEVEL`), la confianza y la diferencia entre
categorías y total. Fuentes por puerto (`KnownSourcesPort`): COMMITMENTS (`projectForForecast`, `listResolved`) y DEBT
(`listUpcomingInstallments`). `pnpm forecast:backtest:report` imprime solo métricas agregadas por tipo de serie.
