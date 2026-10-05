---
id: TC-PLANNING-BUDGET-009
title: 'El progreso muestra restante, porcentaje y proyección lineal a mitad y al final del periodo'
spec: planning/budgets
related_specs: []
requirement: 'Progreso por línea con restante, porcentaje y proyección'
scenario: 'Proyección a mitad de mes'
requirement_status: provisional
fr: ['FR-PLANNING-024']
nfr: ['NFR-USAB-004']
invariants: ['INV-020']
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags: ['budgets', 'progress', 'projection', 'timezone']
error_code: null
preconditions:
  - '"Supermercado" con máximo 1500.00 BOB'
  - 'Hoy 2026-11-10 en America/La_Paz (10 de 30 días transcurridos)'
input:
  actualNov: '550.00 BOB'
  actualOct: '1320.00 BOB'
steps:
  - 'Calcular el progreso de "2026-11"'
  - 'Calcular el progreso de "2026-10" el mismo día'
expected_result:
  - '"2026-11": restante 950.00 BOB, 36.7 %, proyección 1650.00 BOB (550/10×30) con aviso de que supera el máximo'
  - '"2026-10": proyección igual al gastado, 1320.00 BOB'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-BUDGET-009 — El progreso muestra restante, porcentaje y proyección lineal a mitad y al final del periodo

## Intención

FR-PLANNING-024: el usuario ve a mitad de mes si va camino a exceder el presupuesto; los días se cuentan en la TZ del workspace (RISK-020).

## Escenario

```gherkin
Dado "Supermercado" con máximo 1500.00 BOB y gastado 550.00 BOB
  Y hoy es 2026-11-10 en La Paz
Cuando consulto el progreso
Entonces el restante es 950.00 BOB, el uso 36.7 % y la proyección 1650.00 BOB
Cuando consulto "2026-10" con gastado 1320.00 BOB
Entonces la proyección es 1320.00 BOB
```

## Notas

- Cubre también el scenario "Periodo terminado".
- draft: la proyección para líneas fijas depende de la pregunta abierta 8 de add-budgets.
