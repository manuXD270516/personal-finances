---
id: TC-PLANNING-REPORT-002
title: El reporte de cierre muestra variaciones contra el periodo anterior
spec: planning/month-closing
related_specs: []
requirement: Variaciones respecto al periodo anterior
scenario: Octubre contra septiembre
requirement_status: confirmed
fr:
  - FR-PLANNING-007
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/month-closing.api.test.ts
  - apps/web/src/ui/planning/closing.test.tsx
  - packages/contexts/planning/src/application/closing.service.test.ts
  - packages/contexts/planning/src/domain/close-snapshot.test.ts
status: automated
regression_suite: false
phase: 2
tags:
  - month-closing
  - report
  - mom
error_code: null
preconditions:
  - Snapshot vigente de "2026-09" con gastos consolidados 7900.00 BOB
  - Snapshot de "2026-10" con 8450.50 BOB
  - '"2026-07" primer periodo cerrado'
input:
  - period: 2026-10
  - period: 2026-07
steps:
  - Calcular el reporte de "2026-10"
  - Calcular el reporte de "2026-07"
expected_result:
  - 'Variación de gastos de "2026-10": +550.50 BOB (+7.0 %)'
  - '"2026-07" indica que no hay periodo anterior, sin variaciones'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-REPORT-002 — El reporte de cierre muestra variaciones contra el periodo anterior

## Intención

FR-PLANNING-007 (Q7 ¿cómo estoy vs mes pasado?) con cifras congeladas.

## Escenario

```gherkin
Dado que septiembre cerró con gastos de 7900.00 BOB y octubre con 8450.50 BOB
Cuando se consulta el reporte de cierre de octubre
Entonces la variación de gastos es +550.50 BOB (+7.0 %)
```

## Notas

- Requirement Should. 550.50 / 7900.00 = 0.06968 => 7.0 % (HALF_EVEN a un decimal). Cubre "Primer periodo cerrado".
