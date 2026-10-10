---
id: TC-COMMITMENTS-RECUR-045
title: 'Propiedad: la expansión es ordenada, dentro de la ventana y el ajuste de fin de semana nunca cae en sábado o domingo'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cadencias predefinidas con intervalo'
scenario: 'Quincenal'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-002', 'FR-COMMITMENTS-005']
nfr: []
invariants: []
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/shared-kernel/src/recurrence/recurrence.properties.test.ts
  - packages/shared-kernel/src/recurrence/recurrence.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'pbt']
error_code: null
preconditions:
  - 'Generadores fast-check de reglas y ventanas; TZ forzada UTC, America/La_Paz y Europe/Madrid'
input:
  runs: '100 en PR, 10000 nightly'
  fixed: 'BIWEEKLY desde 2026-10-02'
steps:
  - '∀ regla, ∀ ventana: expand y aplicar ajustes'
expected_result:
  - 'Fechas estrictamente crecientes y dentro de la ventana'
  - 'Ninguna fecha nominal fuera del mes de su ancla (clamp)'
  - 'Con PREVIOUS/NEXT ningún vencimiento en sábado/domingo y |vencimiento − nominal| ≤ 2 días'
  - 'Caso fijo: 2026-10-02, 2026-10-16, 2026-10-30, 2026-11-13, 2026-11-27'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-045 — Propiedad: la expansión es ordenada, dentro de la ventana y el ajuste de fin de semana nunca cae en sábado o domingo

## Intención

RISK-020: invariantes del motor de fechas.

## Escenario

```gherkin
Dado una definición quincenal desde el viernes 2026-10-02
Cuando se expanden octubre y noviembre
Entonces las fechas son 2026-10-02, 2026-10-16, 2026-10-30, 2026-11-13 y 2026-11-27
```

## Notas

