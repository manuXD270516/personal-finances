---
id: TC-CLASSIFICATION-MERGE-022
title: "La destino sin categoría por defecto hereda la de la origen"
spec: classification/counterparties
related_specs: []
requirement: "Fusionar contrapartes"
scenario: "Categoría por defecto heredada"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-013","FR-CLASSIFICATION-011"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/application/merge.service.test.ts
  - packages/contexts/classification/src/domain/merge-policy.test.ts
status: automated
regression_suite: true
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
updated: 2026-11-27
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
