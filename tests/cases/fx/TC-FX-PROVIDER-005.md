---
id: TC-FX-PROVIDER-005
title: "El job programado registra cada muestra nueva una sola vez como tasa inmutable con su procedencia"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Registro periódico de tasas de provider como históricas inmutables"
scenario: "Muestra repetida no se duplica"
requirement_status: confirmed
fr: ["FR-FX-009","FR-FX-003"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011","INV-028"]
priority: critical
type: integration
level: container-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
  - packages/contexts/fx/src/application/provider-settings.test.ts
  - packages/contexts/fx/test/integration/providers.int.test.ts
  - apps/api/src/worker/fx-jobs.test.ts
  - apps/api/test/api/fx-providers.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","provider","job","pg-boss","idempotency"]
error_code: null
preconditions:
  - "PostgreSQL y pg-boss en Testcontainers; worker con FX_POLL_INTERVAL=15m"
  - "Providers simulados por servidor local con el fixture paralelo-bo/rate.ok.json"
  - "Un workspace activo con BOB, USD, USDT"
input: {"cycles": ["2026-10-02T09:00:00Z", "2026-10-02T09:15:00Z"], "provider_timestamp": "2026-10-02T08:53:07.532Z", "variant_interval": "30m"}
steps:
  - "Ejecutar el ciclo de las 09:00:00Z"
  - "Ejecutar el ciclo de las 09:15:00Z con el mismo timestamp"
  - "Intentar UPDATE y DELETE de la tasa con el rol pf_app y pf_worker"
  - "Variante: configurar FX_POLL_INTERVAL=30m y registrar las colas"
expected_result:
  - "Tras 09:00: 2 tasas (USD/BOB y USDT/BOB PARALLEL 12.02) con source PROVIDER, provider PARALELO_BO, asOf 08:53:07.532Z, fetchedAt 09:00:00Z y raw_payload igual al fixture"
  - "Tras 09:00: 2 eventos fx.RateRecorded.v1 en el outbox con payload.provider = PARALELO_BO y actor.type = SYSTEM"
  - "Tras 09:15: 0 tasas y 0 eventos nuevos; fx.provider_run registra outcome NO_NEW_SAMPLE a las 09:15:00Z"
  - "UPDATE y DELETE fallan por permisos; leer la tasa por id devuelve siempre 12.02"
  - "Variante: el cron registrado es */30 * * * *"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-PROVIDER-005 — El job programado registra cada muestra nueva una sola vez como tasa inmutable con su procedencia

## Intención

El polling cada 15 minutos no puede inflar ni reescribir el histórico (RISK-003, INV-011).

## Escenario

```gherkin
Dado que a las 09:00Z se registró USD/BOB PARALLEL 12.02 con vigencia 08:53:07.532Z
Cuando a las 09:15Z el provider devuelve el mismo timestamp
Entonces no se registra ninguna tasa nueva
  Y el intento queda registrado como exitoso sin muestra nueva
```

## Notas

- Idempotencia por índice único `(workspace_id, provider, base, quote, rate_type, as_of)`.
- Datos ficticios salvo la respuesta del provider (verificada el 2026-10-02).
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
