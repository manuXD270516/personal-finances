---
id: TC-COMMITMENTS-SUBS-021
title: 'Una diferencia igual o menor a la tolerancia no crea propuesta'
spec: commitments/subscriptions
related_specs: ['commitments/recurrence-engine']
requirement: 'Detección de cambio de precio con tolerancia'
scenario: 'Diferencia exactamente en el límite'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-014']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/subscriptions.service.test.ts
  - packages/contexts/commitments/src/domain/subscription/pricing.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['subscriptions', 'price-detection', 'boundary']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - '"Gimnasio Centro" 250.00 BOB tolerancia 1.00 %'
  - '"MusicBox" 9.99 USD tolerancia 1.00 %'
input:
  charges: ['252.50 BOB (1.00 %)', '10.05 USD (0.60 %)', '252.51 BOB (1.00 % HALF_EVEN pero 1.004 > 1)']
steps:
  - 'Evaluar cada cargo con PriceChangeDetector'
expected_result:
  - '252.50 BOB ⇒ WITHIN_TOLERANCE'
  - '10.05 USD ⇒ WITHIN_TOLERANCE'
  - '252.51 BOB ⇒ PRICE_CHANGE_DETECTED (la comparación usa precisión completa, no el desvío redondeado)'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-SUBS-021 — Una diferencia igual o menor a la tolerancia no crea propuesta

## Intención

Borde de la tolerancia: estrictamente mayor, comparado sin redondeo intermedio.

## Escenario

```gherkin
Dado "Gimnasio Centro" a 250.00 BOB con tolerancia 1.00 %
Cuando su cargo es de 252.50 BOB
Entonces no se crea ninguna propuesta
```

## Notas

- Cubre también el scenario "Diferencia dentro de la tolerancia".
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
