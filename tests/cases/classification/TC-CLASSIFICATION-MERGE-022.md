---
id: TC-CLASSIFICATION-MERGE-022
title: "La destino sin categoría por defecto hereda la de la origen"
spec: classification/counterparties
related_specs: []
requirement: "Fusionar contrapartes"
scenario: "Categoría por defecto heredada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-013","FR-CLASSIFICATION-011"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","counterparties"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; \"Hipermaxi\" sin categoría por defecto; \"HIPERMAXI S.A.\" con \"Supermercado\" activa como categoría por defecto"
input: {}
steps:
  - "se fusiona \"HIPERMAXI S.A.\" en \"Hipermaxi\""
expected_result:
  - "\"Hipermaxi\" tiene \"Supermercado\" como categoría por defecto"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-022 — La destino sin categoría por defecto hereda la de la origen

## Intención

Verifica el scenario "Categoría por defecto heredada" del requirement "Fusionar contrapartes" de `classification/counterparties` (FR-CLASSIFICATION-013, FR-CLASSIFICATION-011).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "Hipermaxi" sin categoría por defecto; "HIPERMAXI S.A." con "Supermercado" activa como categoría por defecto
Cuando se fusiona "HIPERMAXI S.A." en "Hipermaxi"
Entonces "Hipermaxi" tiene "Supermercado" como categoría por defecto
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
