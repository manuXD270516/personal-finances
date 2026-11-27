---
id: TC-CLASSIFICATION-MERGE-025
title: "Vista previa de la fusión de HIPERMAXI S.A. sin cambios"
spec: classification/counterparties
related_specs: []
requirement: "Vista previa de la fusión de contrapartes"
scenario: "Vista previa de HIPERMAXI S.A."
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-013"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/category-merge.api.test.ts
  - apps/web/src/ui/classification/merge.test.tsx
  - packages/contexts/classification/src/application/merge.service.test.ts
status: automated
regression_suite: true
phase: 9
tags: ["merge","counterparties","preview"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB; octubre de 2026 cerrado y noviembre abierto"
  - "\"HIPERMAXI S.A.\" con 4 gastos en noviembre, 1 en octubre, 1 suscripción, 1 regla y el alias \"hipermaxi sa\"; usuario VIEWER"
input: {}
steps:
  - "el VIEWER pide la vista previa de la fusión en \"Hipermaxi\""
expected_result:
  - "counts: TRANSACTIONS_OPEN 4, TRANSACTIONS_CLOSED_KEPT 1, SUBSCRIPTIONS 1, RULES 1, ALIASES_MOVED 1; conflicts vacío"
  - "nada cambia"
created: 2026-11-25
updated: 2026-11-27
---

# TC-CLASSIFICATION-MERGE-025 — Vista previa de la fusión de HIPERMAXI S.A. sin cambios

## Intención

Verifica el scenario "Vista previa de HIPERMAXI S.A." del requirement "Vista previa de la fusión de contrapartes" de `classification/counterparties` (FR-CLASSIFICATION-013).

## Escenario

```gherkin
Dado Workspace "W1" en BOB; octubre de 2026 cerrado y noviembre abierto
Y "HIPERMAXI S.A." con 4 gastos en noviembre, 1 en octubre, 1 suscripción, 1 regla y el alias "hipermaxi sa"; usuario VIEWER
Cuando el VIEWER pide la vista previa de la fusión en "Hipermaxi"
Entonces counts: TRANSACTIONS_OPEN 4, TRANSACTIONS_CLOSED_KEPT 1, SUBSCRIPTIONS 1, RULES 1, ALIASES_MOVED 1; conflicts vacío
Y nada cambia
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
