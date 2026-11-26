---
id: TC-CLASSIFICATION-MERGE-027
title: "Desarchivar una contraparte fusionada se rechaza con COUNTERPARTY_MERGED"
spec: classification/counterparties
related_specs: []
requirement: "Una contraparte fusionada no se desarchiva ni se vuelve a fusionar"
scenario: "Desarchivar una contraparte fusionada"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-013"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","counterparties"]
error_code: "COUNTERPARTY_MERGED"
preconditions:
  - "Workspace \"W1\" en BOB; \"HIPERMAXI S.A.\" fusionada en \"Hipermaxi\"; usuario EDITOR"
input: {}
steps:
  - "se intenta desarchivar \"HIPERMAXI S.A.\""
expected_result:
  - "responde 409 COUNTERPARTY_MERGED indicando \"Hipermaxi\""
  - "\"HIPERMAXI S.A.\" sigue ARCHIVED"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-027 — Desarchivar una contraparte fusionada se rechaza con COUNTERPARTY_MERGED

## Intención

Verifica el scenario "Desarchivar una contraparte fusionada" del requirement "Una contraparte fusionada no se desarchiva ni se vuelve a fusionar" de `classification/counterparties` (FR-CLASSIFICATION-013).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; "HIPERMAXI S.A." fusionada en "Hipermaxi"; usuario EDITOR
Cuando se intenta desarchivar "HIPERMAXI S.A."
Entonces responde 409 COUNTERPARTY_MERGED indicando "Hipermaxi"
Y "HIPERMAXI S.A." sigue ARCHIVED
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
