---
id: TC-CLASSIFICATION-MERGE-024
title: "El gasto de un periodo cerrado conserva la contraparte origen"
spec: classification/counterparties
related_specs: ["planning/month-closing"]
requirement: "Fusionar contrapartes"
scenario: "Gasto en un periodo cerrado"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-013","FR-PLANNING-005"]
nfr: []
invariants: ["INV-019"]
priority: medium
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","counterparties","closed-periods"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; octubre de 2026 cerrado y noviembre abierto"
  - "\"HIPERMAXI S.A.\" con un gasto de 60.00 BOB en octubre y 4 gastos en noviembre"
input: {}
steps:
  - "se fusiona \"HIPERMAXI S.A.\" en \"Hipermaxi\""
expected_result:
  - "el gasto de 60.00 BOB de octubre conserva \"HIPERMAXI S.A.\", mostrada como archivada y fusionada en \"Hipermaxi\""
  - "los 4 gastos de noviembre tienen \"Hipermaxi\""
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-024 — El gasto de un periodo cerrado conserva la contraparte origen

## Intención

Verifica el scenario "Gasto en un periodo cerrado" del requirement "Fusionar contrapartes" de `classification/counterparties` (FR-CLASSIFICATION-013, FR-PLANNING-005).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; octubre de 2026 cerrado y noviembre abierto
Y "HIPERMAXI S.A." con un gasto de 60.00 BOB en octubre y 4 gastos en noviembre
Cuando se fusiona "HIPERMAXI S.A." en "Hipermaxi"
Entonces el gasto de 60.00 BOB de octubre conserva "HIPERMAXI S.A.", mostrada como archivada y fusionada en "Hipermaxi"
Y los 4 gastos de noviembre tienen "Hipermaxi"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
