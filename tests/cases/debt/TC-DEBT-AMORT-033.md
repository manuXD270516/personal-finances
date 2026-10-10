---
id: TC-DEBT-AMORT-033
title: 'PBT: todo recálculo conserva las cuotas pagadas y suma el pendiente'
spec: debt/amortization
related_specs: []
requirement: 'Nueva versión del cronograma sin reescribir cuotas pagadas'
scenario: null
requirement_status: provisional
fr: ['FR-DEBT-008', 'FR-DEBT-009']
nfr: []
invariants: ['INV-017']
priority: high
type: property
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'pbt', 'versioning']
error_code: null
preconditions:
  - 'Generadores de préstamo, secuencia de pagos de cuotas completas y evento (prepago con opción o cambio de tasa)'
input: {}
steps:
  - 'Se recalcula el cronograma tras el evento'
expected_result:
  - 'Las cuotas pagadas son idénticas antes y después'
  - 'La suma del principal de la versión nueva es el principal pendiente'
  - 'El interés restante con reducir plazo es menor o igual que con reducir cuota'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-033 — PBT: todo recálculo conserva las cuotas pagadas y suma el pendiente

## Intención

La versión nueva nunca reescribe lo pagado y su principal suma exactamente el pendiente; reducir plazo nunca da más interés que reducir cuota.

## Escenario

```gherkin
Dado generadores de préstamo, secuencia de pagos de cuotas completas y evento (prepago con opción o cambio de tasa)
Cuando se recalcula el cronograma tras el evento
Entonces las cuotas pagadas son idénticas antes y después
  Y la suma del principal de la versión nueva es el principal pendiente
  Y el interés restante con reducir plazo es menor o igual que con reducir cuota
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
