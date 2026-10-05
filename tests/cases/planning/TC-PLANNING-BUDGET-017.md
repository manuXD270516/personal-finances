---
id: TC-PLANNING-BUDGET-017
title: 'El rollover traslada el remanente o el exceso con tope y sin planificado negativo'
spec: planning/budgets
related_specs: []
requirement: 'Rollover del remanente al periodo siguiente'
scenario: 'Remanente positivo trasladado'
requirement_status: provisional
fr: ['FR-PLANNING-020']
nfr: []
invariants: ['INV-020']
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['budgets', 'rollover']
error_code: null
preconditions:
  - '"Restaurantes" con máximo 600.00 BOB en "2026-10" y en "2026-11"'
input:
  carryPositive520: 'gastado oct 520.00 BOB, CARRY_POSITIVE'
  cap50: 'tope 50.00 BOB'
  carryAll650: 'gastado oct 650.00 BOB, CARRY_ALL'
  carryPositive650: 'gastado oct 650.00 BOB, CARRY_POSITIVE'
steps:
  - 'Calcular el planificado efectivo de "2026-11" en cada caso'
expected_result:
  - 'Solo positivo con 520.00 ⇒ 680.00 BOB'
  - 'Con tope 50.00 ⇒ 650.00 BOB'
  - 'Completa con 650.00 ⇒ 550.00 BOB'
  - 'Solo positivo con 650.00 ⇒ 600.00 BOB'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-BUDGET-017 — El rollover traslada el remanente o el exceso con tope y sin planificado negativo

## Intención

FR-PLANNING-020 (Should): el remanente o exceso pasa al periodo siguiente, con tope opcional; el planificado efectivo nunca es negativo.

## Escenario

```gherkin
Dado "Restaurantes" con máximo 600.00 BOB en octubre y noviembre
Cuando en octubre se gastaron 520.00 BOB con rollover solo positivo
Entonces el planificado efectivo de noviembre es 680.00 BOB
  Y con tope 50.00 BOB es 650.00 BOB
Cuando en octubre se gastaron 650.00 BOB con política completa
Entonces el planificado efectivo de noviembre es 550.00 BOB
```

## Notas

- Cubre los scenarios "Remanente con tope" y "Exceso trasladado con política completa".
- PBT: planificado efectivo ≥ 0.00 para toda combinación.
