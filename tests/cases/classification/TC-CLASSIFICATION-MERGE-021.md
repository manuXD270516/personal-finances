---
id: TC-CLASSIFICATION-MERGE-021
title: "Fusionar HIPERMAXI S.A. en Hipermaxi mueve gastos y alias"
spec: classification/counterparties
related_specs: ["transactions/transaction-recording"]
requirement: "Fusionar contrapartes"
scenario: "Fusionar HIPERMAXI S.A. en Hipermaxi"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-013","FR-CLASSIFICATION-010","FR-AUDIT-001"]
nfr: []
invariants: ["INV-019","INV-021"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
  - apps/web/src/ui/classification/merge.test.tsx
  - packages/contexts/classification/src/application/merge.service.test.ts
  - packages/contexts/classification/src/domain/merge-policy.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","counterparties","aliases"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; noviembre de 2026 abierto; usuario EDITOR"
  - "\"HIPERMAXI S.A.\" con 4 gastos de noviembre que suman 512.40 BOB y el alias \"hipermaxi sa\"; \"Hipermaxi\" activa"
input: {}
steps:
  - "se fusiona \"HIPERMAXI S.A.\" en \"Hipermaxi\""
  - "se resuelve la descripción \"COMPRA HIPERMAXI S.A. 4471\""
expected_result:
  - "los 4 gastos tienen la contraparte \"Hipermaxi\" y su historial suma 512.40 BOB más lo que ya tenía"
  - "\"Hipermaxi\" tiene los alias \"hipermaxi sa\" y \"HIPERMAXI S.A.\", y la descripción se reconoce como \"Hipermaxi\""
  - "\"HIPERMAXI S.A.\" queda ARCHIVED con mergedInto \"Hipermaxi\" y el número de asientos no cambia"
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-021 — Fusionar HIPERMAXI S.A. en Hipermaxi mueve gastos y alias

## Intención

Verifica el scenario "Fusionar HIPERMAXI S.A. en Hipermaxi" del requirement "Fusionar contrapartes" de `classification/counterparties` (FR-CLASSIFICATION-013, FR-CLASSIFICATION-010, FR-AUDIT-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; noviembre de 2026 abierto; usuario EDITOR
Y "HIPERMAXI S.A." con 4 gastos de noviembre que suman 512.40 BOB y el alias "hipermaxi sa"; "Hipermaxi" activa
Cuando se fusiona "HIPERMAXI S.A." en "Hipermaxi"
Y se resuelve la descripción "COMPRA HIPERMAXI S.A. 4471"
Entonces los 4 gastos tienen la contraparte "Hipermaxi" y su historial suma 512.40 BOB más lo que ya tenía
Y "Hipermaxi" tiene los alias "hipermaxi sa" y "HIPERMAXI S.A.", y la descripción se reconoce como "Hipermaxi"
Y "HIPERMAXI S.A." queda ARCHIVED con mergedInto "Hipermaxi" y el número de asientos no cambia
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
