---
id: TC-NOTIFICATIONS-FX-023
title: "PBT: el grupo de un par es único, estable mientras no se interrumpe e independiente del orden"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: null
requirement_status: confirmed
fr: ["FR-NOTIFY-005"]
nfr: []
invariants: ["INV-028"]
priority: high
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/anomaly-group-resolver.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly", "pbt"]
error_code: null
preconditions:
  - "Generador de muestras retenidas de un par con instantes de creación y revisiones arbitrarias"
input: {"runs": 200}
steps:
  - "Calcular el grupo vigente con AnomalyGroupResolver para entradas permutadas"
  - "Agregar muestras pendientes y revisiones parciales sin vaciar el par"
expected_result:
  - "Hay a lo sumo un grupo vigente y existe solo si alguna muestra está pendiente"
  - "El ancla no cambia mientras el par tenga siempre alguna pendiente"
  - "El resultado no depende del orden de entrada"
  - "pendingCount ≤ retainedCount y reviewRateId es la pendiente más antigua"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-023 — PBT: el grupo de un par es único, estable mientras no se interrumpe e independiente del orden

## Intención

Propiedades de la clave de grupo que hacen idempotente la deduplicación.

## Escenario

```gherkin
Dado muestras retenidas y revisiones arbitrarias de un par
Cuando se calcula el grupo
Entonces se cumplen las propiedades
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping`.
