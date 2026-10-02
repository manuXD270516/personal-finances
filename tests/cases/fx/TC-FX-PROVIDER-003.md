---
id: TC-FX-PROVIDER-003
title: "Los valores numéricos del provider se leen como decimal exacto sin pasar por punto flotante"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Lectura exacta de los valores publicados por los providers"
scenario: "Valor con 18 decimales"
requirement_status: confirmed
fr: ["FR-FX-009"]
nfr: ["NFR-DATA-001"]
invariants: ["INV-001"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["fx","provider","lossless","money","fast-check"]
error_code: null
preconditions:
  - "Fixture paralelo-bo/rate.18-decimals.json con median 12.020000000000000001"
input: {"fixture": "paralelo-bo/rate.18-decimals.json", "numRuns_pr": 1000}
steps:
  - "Leer el fixture con LosslessJsonReader"
  - "Propiedad: para todo decimal positivo d con ≤ 18 decimales serializado como número JSON, leer(texto(d)) == d"
expected_result:
  - "La tasa registrada vale exactamente \"12.020000000000000001\""
  - "Leer el mismo texto con JSON.parse daría 12.02 (el test lo documenta como contraejemplo)"
  - "La propiedad se cumple en todas las corridas"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-003 — Los valores numéricos del provider se leen como decimal exacto sin pasar por punto flotante

## Intención

INV-001: un número JSON de un tercero es la vía más fácil de colar un float en el sistema.

## Escenario

```gherkin
Dado paralelo.bo responde median 12.020000000000000001
Cuando el adapter lee la respuesta
Entonces la tasa se registra como 12.020000000000000001
  Y no como 12.02
```

## Notas

- Fixture `paralelo-bo/rate.18-decimals.json`:

```json
{"timestamp":"2026-10-02T09:08:00.000Z","buy":12.12,"sell":11.92,"median":12.020000000000000001,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}
```

- El test de arquitectura de la tarea 4.5 prohíbe `JSON.parse`/`response.json()` en los adapters.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
