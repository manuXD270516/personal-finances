---
id: TC-COMMITMENTS-SUBS-025
title: 'El costo mensualizado y anualizado de las suscripciones del owner se valora en BOB con la tasa paralela de hoy'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Costo mensualizado y anualizado en moneda base'
scenario: 'Costo de las suscripciones del owner'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-015']
nfr: []
invariants: ['INV-001', 'INV-002']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/subscriptions.api.test.ts
  - apps/api/test/perf/subscriptions.perf.ts
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/pricing.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'cost', 'fx', 'valuation']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Hoy 2026-11-10'
  - 'Tasas paralelas vigentes USD/BOB 9.80 y USDT/BOB 9.70'
  - 'Activas: Streamly 10.99 USD mensual, CloudDrive 99.99 USD anual, VPN Pro 5.000000 USDT mensual, Gimnasio Centro 250.00 BOB mensual'
input:
  endpoint: 'GET W/subscriptions/cost-summary'
steps:
  - 'Consultar el costo'
expected_result:
  - 'Streamly 107.70 BOB/mes y 1292.42 BOB/año'
  - 'CloudDrive 81.66 BOB/mes y 979.90 BOB/año'
  - 'VPN Pro 48.50 BOB/mes y 582.00 BOB/año'
  - 'Gimnasio Centro 250.00 BOB/mes y 3000.00 BOB/año'
  - 'Total 487.86 BOB/mes y 5854.33 BOB/año, complete true, ratesUsed con USD/BOB y USDT/BOB PARALLEL'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-025 — El costo mensualizado y anualizado de las suscripciones del owner se valora en BOB con la tasa paralela de hoy

## Intención

FR-COMMITMENTS-015 con la misma valoración que el Home y los presupuestos (FlowValuation, docs/33 D109); totales sumados a precisión completa y redondeados al presentar.

## Escenario

```gherkin
Dado cuatro suscripciones activas en USD, USDT y BOB
Cuando consulto el costo el 2026-11-10
Entonces el total es 487.86 BOB al mes
  Y 5854.33 BOB al año
```

## Notas

- Cálculo: 131.88 × 9.80 = 1292.424; 99.99 × 9.80 = 979.902; 60 × 9.70 = 582; 3000; Σ = 5854.326; /12 = 487.8605. Cubre "Cadencia semanal" (20.00 BOB ⇒ 1040.00/año, 86.67/mes) y "Trial y pausada fuera del total" (PhotoLab 4.99 USD ⇒ 48.90 BOB/mes aparte).
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
