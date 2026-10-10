---
id: TC-COMMITMENTS-RECUR-010
title: 'Un gasto MIN_MAX informa el rango y proyecta el máximo'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Tipos de monto'
scenario: 'Gimnasio con rango'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-004']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/definition.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'amount']
error_code: null
preconditions:
  - 'Cuenta "Banco BOB"'
input:
  definition: 'Gimnasio MIN_MAX 100.00..180.00 BOB mensual día 28'
  variable: 'Compra mayorista VARIABLE'
steps:
  - 'Crear ambas definiciones y generar ocurrencias'
expected_result:
  - 'Cada ocurrencia del Gimnasio informa 100.00–180.00 BOB y projectedAmount 180.00 BOB'
  - 'Las ocurrencias de Compra mayorista no tienen monto esperado'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-010 — Un gasto MIN_MAX informa el rango y proyecta el máximo

## Intención

FR-COMMITMENTS-004: las proyecciones usan el peor caso.

## Escenario

```gherkin
Dado el gasto recurrente "Gimnasio" MIN_MAX de 100.00 a 180.00 BOB
Cuando se generan sus ocurrencias
Entonces cada una informa el rango y 180.00 BOB como monto proyectado
```

## Notas

- Cubre el scenario "Variable sin monto".
