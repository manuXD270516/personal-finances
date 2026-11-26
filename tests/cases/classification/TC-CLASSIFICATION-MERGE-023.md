---
id: TC-CLASSIFICATION-MERGE-023
title: "Una contraparte destino archivada rechaza la fusión"
spec: classification/counterparties
related_specs: []
requirement: "Fusionar contrapartes"
scenario: "Destino archivada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-013"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
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
updated: 2026-11-25
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
