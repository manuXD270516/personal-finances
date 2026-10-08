---
id: TC-PLANNING-TEMPLATE-017
title: 'La propagación nunca toca periodos cerrados, reabiertos ni activos'
spec: planning/budget-templates
related_specs: ['planning/budgets', 'planning/financial-periods']
requirement: 'Propagación limitada a periodos futuros en borrador'
scenario: 'Octubre cerrado y noviembre activo intactos'
requirement_status: confirmed
fr: ['FR-PLANNING-014']
nfr: []
invariants: ['INV-015']
priority: high
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/application/propagation.service.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['templates', 'propagation', 'period-closed', 'pbt']
error_code: null
preconditions:
  - '"2026-10" cerrado, "2026-11" activo y "2026-12" en borrador, todos desde "Mes estándar" con "Alquiler" 2800.00 BOB'
input:
  change: 'Alquiler FIXED 2900.00 BOB desde el template'
steps:
  - 'Propagar y confirmar'
  - 'PBT: secuencias aleatorias de propagaciones sobre periodos en estados aleatorios'
expected_result:
  - 'Solo "2026-12" pasa a 2900.00 BOB'
  - '"2026-10" y "2026-11" conservan 2800.00 BOB'
  - 'Para toda secuencia, ningún plan de periodo no borrador cambia'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-TEMPLATE-017 — La propagación nunca toca periodos cerrados, reabiertos ni activos

## Intención

FR-PLANNING-014: nunca a periodos cerrados (INV-015).

## Escenario

```gherkin
Dado "2026-10" cerrado, "2026-11" activo y "2026-12" en borrador
Cuando propago "Alquiler" 2900.00 BOB
Entonces solo "2026-12" cambia
```

## Notas

