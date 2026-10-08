---
id: TC-PLANNING-BUDGET-011
title: 'El disponible para gastar suma los restantes positivos sin restar los excesos'
spec: planning/budgets
related_specs: []
requirement: 'Disponible para gastar agregado'
scenario: 'Disponible con una línea excedida'
requirement_status: confirmed
fr: ['FR-PLANNING-024']
nfr: []
invariants: ['INV-020']
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['budgets', 'available-to-spend', 'q5']
error_code: null
preconditions:
  - 'Plan de "2026-11" con "Supermercado" máximo 1500.00 BOB, "Restaurantes" máximo 600.00 BOB y "Alquiler" fijo 2800.00 BOB'
input:
  actualSupermercado: '550.00 BOB'
  actualRestaurantes: '650.00 BOB'
  actualAlquiler: '0.00 BOB'
steps:
  - 'Calcular los totales del plan'
expected_result:
  - 'Disponible para gastar 3750.00 BOB (950.00 + 0.00 + 2800.00)'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-011 — El disponible para gastar suma los restantes positivos sin restar los excesos

## Intención

FR-PLANNING-024: insumo de Q5 "¿cuánto puedo gastar?"; una línea excedida no resta disponible de las demás.

## Escenario

```gherkin
Dado "Supermercado" 1500.00/550.00, "Restaurantes" 600.00/650.00 y "Alquiler" 2800.00/0.00 BOB
Cuando calculo el disponible para gastar
Entonces es 3750.00 BOB
```

## Notas

- PBT asociado: el disponible nunca es negativo.
