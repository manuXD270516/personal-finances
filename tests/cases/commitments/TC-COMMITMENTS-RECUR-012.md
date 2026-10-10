---
id: TC-COMMITMENTS-RECUR-012
title: 'El día 31 y el 29 de febrero producen el último día del mes en meses cortos'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Día 29 a 31 en meses cortos'
scenario: 'Día 31 en febrero y abril'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-005']
nfr: []
invariants: []
priority: critical
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/shared-kernel/src/recurrence/recurrence.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'end-of-month']
error_code: null
preconditions:
  - 'Ninguna'
input:
  monthly: 'MONTHLY día 31 desde 2027-01-31'
  annual: 'ANNUAL 29-feb desde 2028-02-29'
steps:
  - 'Expandir la mensual hasta 2027-04-30'
  - 'Expandir la anual hasta 2030-03-01'
expected_result:
  - '[2027-01-31, 2027-02-28, 2027-03-31, 2027-04-30]'
  - '[2028-02-29, 2029-02-28, 2030-02-28]'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-012 — El día 31 y el 29 de febrero producen el último día del mes en meses cortos

## Intención

FR-COMMITMENTS-005 y RISK-020: ningún mes se omite por no tener el día.

## Escenario

```gherkin
Dado una definición mensual el día 31 desde 2027-01-31
Cuando se generan cuatro meses
Entonces las fechas son 2027-01-31, 2027-02-28, 2027-03-31 y 2027-04-30
```

## Notas

- Cubre el scenario "Día 29 en año bisiesto". Desviación deliberada de RFC 5545 (design decisión 4).
