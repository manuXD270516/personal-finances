---
id: TC-DEBT-CARD-006
title: 'Ciclos con cierre y vencimiento en meses cortos y año bisiesto'
spec: debt/credit-cards
related_specs: []
requirement: 'Fechas de cierre y vencimiento del ciclo'
scenario: 'Cierre el día 31 en meses cortos'
requirement_status: confirmed
fr: ['FR-DEBT-013']
nfr: []
invariants: []
priority: critical
type: property
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/debt/src/domain/card-cycle-calendar.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'dates']
error_code: null
preconditions:
  - 'Tarjetas con (cierre 25, vto 15), (cierre 31, vto 20), (cierre 30), (cierre 10, vto 31), sin ajuste'
input:
  months: '2026-10..2028-03'
steps:
  - 'Calcular cierres, ciclos y vencimientos'
expected_result:
  - '25/15: ciclo 2026-09-26..2026-10-25, vence 2026-11-15'
  - '31/20: cierres 2027-01-31, 2027-02-28, 2027-03-31; ciclo 2027-03-01..2027-03-31 vence 2027-04-20'
  - '30: cierre 2028-02-29; ciclo 2028-03-01..2028-03-30'
  - '10/31: vencen 2026-10-31 y 2026-11-30'
  - 'PBT: ciclos contiguos, un cierre y un vencimiento por mes'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-006 — Ciclos con cierre y vencimiento en meses cortos y año bisiesto

## Intención

RISK-020: los días 29–31 no deben saltar meses ni solapar ciclos.

## Escenario

```gherkin
Dado una tarjeta que cierra el día 31 y vence el 20
Cuando calculo los ciclos de enero a marzo de 2027
Entonces cierran el 2027-01-31, 2027-02-28 y 2027-03-31
  Y el de marzo vence el 2027-04-20
```

## Notas

- Cubre "Cierre 25 y vencimiento 15", "Cierre el día 30 en año bisiesto" y "Vencimiento el día 31".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
