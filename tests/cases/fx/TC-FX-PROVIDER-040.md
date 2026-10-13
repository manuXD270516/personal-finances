---
id: TC-FX-PROVIDER-040
title: "Cada muestra retenida como anómala publica un único hecho y sigue retenida hasta su revisión"
spec: fx/market-rate-providers
related_specs: []
requirement: "Hecho publicado por cada muestra retenida como anómala"
scenario: "Muestra de bitcoin retenida"
requirement_status: confirmed
fr: ["FR-FX-010", "FR-NOTIFY-005"]
nfr: []
invariants: ["INV-011"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/rate-feed-alerts.test.ts
  - packages/contexts/fx/test/integration/rate-feed-alerts.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "anomaly", "event"]
error_code: null
preconditions:
  - "W1 con BTC/USDT aceptado en 65000.00 del provider cripto principal (simulado)"
input: {"sample": "72000.00"}
steps:
  - "Ingerir la muestra 72000.00"
  - "Repetir el ciclo con la misma vigencia"
  - "Avanzar el reloj 3 días sin revisión"
expected_result:
  - "Se escribe un único fx.RateAnomalyRetained.v1 con valor 72000.00, línea base 65000.00 y variación +10.77 %, que valida contra su schema"
  - "La valoración sigue con 65000.00"
  - "A los 3 días la muestra sigue retenida y no hay otro hecho"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-040 — Cada muestra retenida como anómala publica un único hecho y sigue retenida hasta su revisión

## Intención

D234 y D236: aviso único por muestra y sin aceptación automática.

## Escenario

```gherkin
Dado BTC/USDT aceptado en 65000.00
Cuando llega 72000.00
Entonces se publica un hecho y la muestra queda retenida
```

## Notas

- Cubre "Muestra retenida durante días".
