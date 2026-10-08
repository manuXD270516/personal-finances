---
id: TC-PLANNING-BUDGET-022
title: 'Las líneas fijas y de mínimo no proyectan: muestran pendiente o cumplido'
spec: planning/budgets
related_specs: []
requirement: 'Progreso por línea con restante, porcentaje y proyección'
scenario: 'Línea fija sin proyección'
requirement_status: confirmed
fr: ['FR-PLANNING-024']
nfr: ['NFR-USAB-004']
invariants: ['INV-020']
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/planning/budgets.test.tsx
  - packages/contexts/planning/src/domain/budget-progress-calculator.test.ts
status: automated
regression_suite: true
phase: 2
tags: ['budgets', 'progress', 'projection', 'timezone']
error_code: null
preconditions:
  - 'Plan de "2026-11" (del 2026-11-01 al 2026-11-30) con "Alquiler" fijo 2800.00 BOB y "Educación" mínimo 500.00 BOB'
  - 'Gasto de 2800.00 BOB en "Alquiler" con fecha 2026-11-01; "Educación" con gastado 200.00 BOB'
  - 'FixedClock en America/La_Paz'
input:
  todayBeforePayment: '2026-11-01 (pago aún no registrado)'
  todayAfterPayment: '2026-11-02 (2 de 30 días transcurridos)'
steps:
  - 'Calcular el progreso el 2026-11-01 antes de registrar el pago'
  - 'Registrar el pago y calcular el progreso el 2026-11-02'
expected_result:
  - '2026-11-01: "Alquiler" pendiente, projection null'
  - '2026-11-02: "Alquiler" cumplido (ON_TARGET), restante 0.00 BOB, 100.0 %, projection null (nunca 42000.00 BOB = 2800/2×30)'
  - '"Educación" (MINIMUM): estado PENDING, projection null'
  - 'Una línea MAXIMUM del mismo plan sí informa proyección (regresión de TC-PLANNING-BUDGET-009)'
created: 2026-10-08
updated: 2026-10-08
---

# TC-PLANNING-BUDGET-022 — Las líneas fijas y de mínimo no proyectan: muestran pendiente o cumplido

## Intención

Decisión del owner docs/33 D83 (pregunta 25 de docs/32): la proyección lineal solo tiene sentido en líneas de máximo, rango y porcentaje de ingresos. Un alquiler pagado el día 1 proyectaría 30 veces su monto y daría una alarma falsa.

## Escenario

```gherkin
Dado "Alquiler" con un fijo de 2800.00 BOB pagado el 2026-11-01
Cuando se consulta el progreso el 2026-11-02
Entonces la línea no muestra proyección y se muestra cumplida
  Y antes del pago se mostraba pendiente, sin proyección
```

## Notas

- Montos como strings decimales; fechas fijas con `FixedClock`.
