---
id: TC-DEBT-LOAN-053
title: "La lista de préstamos se obtiene en una sola llamada con las mismas cifras que el detalle"
spec: debt/loans
related_specs: []
requirement: "Detalle y estado del préstamo"
scenario: "Detalle tras la primera cuota"
requirement_status: confirmed
fr: ["FR-DEBT-007"]
nfr: ["NFR-PERF-004"]
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - apps/web/src/ui/debt/debt.test.tsx
  - tests/e2e/specs/loans.spec.ts
status: automated
regression_suite: false
phase: 5
tags: ["loans", "list", "n-plus-one", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "Hoy es 2026-12-16 en America/La_Paz; \"Préstamo vehicular\" de 50000.00 BOB con la cuota 1 pagada y la cuota 2 del 2026-12-15 sin pagar"
  - "Otros 4 préstamos activos en el workspace"
input: {"loans": 5}
steps:
  - "Abrir la pantalla de préstamos y contar las llamadas a la API"
  - "Comparar cada fila de `GET W/loans` con `GET W/loans/{id}`"
expected_result:
  - "La pantalla hace una sola llamada a `GET W/loans` y ninguna a `GET W/loans/{id}`"
  - "La fila de \"Préstamo vehicular\" informa principal pendiente 48137.15 BOB, saldo de la cuenta 48137.15 BOB y la cuota 2 atrasada, igual que el detalle"
created: 2026-10-13
updated: 2026-10-13
---

# TC-DEBT-LOAN-053 — La lista de préstamos se obtiene en una sola llamada con las mismas cifras que el detalle

## Intención

Corrige el N+1 de la lista de préstamos (docs/38 §4) sin cambiar la conducta especificada en `debt/loans` (D219, D222): el TC referencia el requirement existente del change activo `add-loans`.

## Escenario

```gherkin
Dado 5 préstamos activos
Cuando se abre la lista de préstamos
Entonces se hace una sola llamada
  Y las cifras coinciden con el detalle
```

## Notas

- Sin delta de spec: la lista expone campos que ya existen en el detalle.
