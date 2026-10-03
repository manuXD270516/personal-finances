---
id: TC-CLASSIFICATION-TAG-005
title: Renombrar un tag se refleja en el reporte por tag sin tocar transacciones
spec: classification/tags
related_specs: []
requirement: Renombrar un tag no altera el historial
scenario: Renombrar un tag
requirement_status: confirmed
fr: [FR-CLASSIFICATION-008]
nfr: []
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/application/classification.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: [tags]
error_code: null
preconditions:
- Tag "Viaje SCZ" en gastos por 600.00 BOB
input:
  rename:
    from: Viaje SCZ
    to: Viaje Santa Cruz 2026
steps:
- Renombrar el tag
- Consultar el reporte por tag
expected_result:
- El reporte muestra "Viaje Santa Cruz 2026" = 600.00 BOB
- Las asignaciones de tag no cambian
created: 2026-10-02
updated: 2026-10-03
---

# TC-CLASSIFICATION-TAG-005 — Renombrar un tag se refleja en el reporte por tag sin tocar transacciones

## Intención

Referencia por identidad: renombrar no reescribe historia.

## Escenario

```gherkin
Dado el tag "Viaje SCZ" con 600.00 BOB
Cuando se renombra a "Viaje Santa Cruz 2026"
Entonces el reporte muestra "Viaje Santa Cruz 2026" = 600.00 BOB
```
