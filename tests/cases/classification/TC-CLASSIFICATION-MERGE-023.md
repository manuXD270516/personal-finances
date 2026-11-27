---
id: TC-CLASSIFICATION-MERGE-023
title: "Una contraparte destino archivada rechaza la fusión"
spec: classification/counterparties
related_specs: []
requirement: "Fusionar contrapartes"
scenario: "Destino archivada"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-013"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
  - packages/contexts/classification/src/application/merge.service.test.ts
  - packages/contexts/classification/src/domain/merge-policy.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","counterparties"]
error_code: "COUNTERPARTY_ARCHIVED"
preconditions:
  - "Workspace \"W1\" en BOB; \"HIPERMAXI S.A.\" activa con gastos; \"Hiper Viejo\" archivada"
input: {}
steps:
  - "se intenta fusionar \"HIPERMAXI S.A.\" en \"Hiper Viejo\""
expected_result:
  - "se rechaza con COUNTERPARTY_ARCHIVED"
  - "los gastos siguen con \"HIPERMAXI S.A.\""
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-023 — Una contraparte destino archivada rechaza la fusión

## Intención

Verifica el scenario "Destino archivada" del requirement "Fusionar contrapartes" de `classification/counterparties` (FR-CLASSIFICATION-013).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "HIPERMAXI S.A." activa con gastos; "Hiper Viejo" archivada
Cuando se intenta fusionar "HIPERMAXI S.A." en "Hiper Viejo"
Entonces se rechaza con COUNTERPARTY_ARCHIVED
Y los gastos siguen con "HIPERMAXI S.A."
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
