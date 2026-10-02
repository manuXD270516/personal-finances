---
id: TC-FX-PROVIDER-006
title: "La carga del histórico diario de paralelo.bo es completa, idempotente y rellena días faltantes"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Carga inicial del histórico diario de la tasa paralela"
scenario: "Histórico completo"
requirement_status: confirmed
fr: ["FR-FX-013"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011","INV-028"]
priority: high
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","provider","backfill","historical"]
error_code: null
preconditions:
  - "PostgreSQL y pg-boss en Testcontainers; FixedClock en 2026-10-02T12:00:00Z (America/La_Paz 08:00)"
  - "Fixture paralelo-bo/historical.sample.json con 788 puntos diarios del 2024-08-06 al 2026-10-02 (el del 2026-09-10 vale 11.96)"
  - "Evento identity.WorkspaceCreated.v1 de un workspace nuevo"
input: {"points": 788, "from": "2024-08-06", "to": "2026-10-02", "imported_complete_days": 787, "sample_point": {"t": "2026-09-10T00:00:00.000Z", "v": "11.96"}, "gap": ["2026-09-20", "2026-09-21", "2026-09-22"]}
steps:
  - "Entregar WorkspaceCreated y ejecutar fx.backfill-historical-rates"
  - "Reentregar el mismo evento y ejecutar de nuevo la carga"
  - "En un workspace de prueba sin tasas de provider para 2026-09-20..22 (caída simulada), ejecutar fx.fill-rate-gaps"
expected_result:
  - "Se registran 787 tasas PARALLEL USD/BOB y 787 USDT/BOB (2024-08-06..2026-10-01) con source PROVIDER y provider PARALELO_BO"
  - "USD/BOB del 2026-09-10 = \"11.96\" con asOf 2026-09-10T23:59:59-04:00 (2026-09-11T03:59:59Z)"
  - "Se siembran las preferencias USD/BOB y USDT/BOB = PARALLEL"
  - "La segunda ejecución registra 0 tasas (inbox + índice único)"
  - "El relleno registra exactamente 3 tasas diarias por par para 2026-09-20..22 y no toca otros días"
  - "El punto del día en curso (2026-10-02) no se registra: día incompleto"
  - "La carga emite un único fx.RateRecorded.v1 por workspace y ejecución"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-006 — La carga del histórico diario de paralelo.bo es completa, idempotente y rellena días faltantes

## Intención

Sin histórico, los flujos de meses pasados no pueden valorarse a la tasa de su fecha; la carga debe poder repetirse sin efectos.

## Escenario

```gherkin
Dado el histórico de paralelo.bo con 788 puntos diarios
Cuando se configura un workspace
Entonces se registran 787 tasas diarias por par (el día en curso se omite)
  Y repetir la carga no registra nada nuevo
```

## Notas

- Fragmento del fixture `paralelo-bo/historical.sample.json` (estructura verificada el 2026-10-02; los valores de los puntos son de ejemplo salvo el conteo y las fechas extremas):

```json
{"currencyPair":"USD/BOB","market":"parallel","resolution":"daily","license":"CC-BY-4.0","source":"paralelo.bo","methodologyUrl":"https://paralelo.bo/metodologia","points":[{"t":"2024-08-06T00:00:00.000Z","v":9.80},{"t":"2026-09-10T00:00:00.000Z","v":11.96},{"t":"2026-10-01T00:00:00.000Z","v":12.01},{"t":"2026-10-02T00:00:00.000Z","v":12.02}]}
```

- El fixture completo se genera con 788 puntos; el test verifica conteo y extremos.
- La carga histórica no marca anomalías (design.md, decisión 8).
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
