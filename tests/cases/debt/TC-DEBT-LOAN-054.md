---
id: TC-DEBT-LOAN-054
title: "Un préstamo en borrador se edita desde la pantalla y su vista previa se recalcula"
spec: debt/loans
related_specs: ["debt/amortization"]
requirement: "Registrar un préstamo con sus condiciones"
scenario: "Préstamo vehicular en borrador"
requirement_status: provisional
fr: ["FR-DEBT-001"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["loans", "draft", "ui", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "EDITOR autenticado; \"Préstamo vehicular\" en borrador de 50000.00 BOB al 11.50 %, 24 cuotas, 30/360, primera cuota el 2026-11-15"
input: {"term": 36}
steps:
  - "Abrir el borrador y elegir Editar"
  - "Cambiar el plazo de 24 a 36 cuotas y guardar"
expected_result:
  - "El préstamo sigue en borrador con 36 cuotas y la vista previa muestra 36 cuotas recalculadas"
  - "El saldo de \"Préstamo vehicular\" sigue en 0.00 BOB y no existe ninguna transacción del préstamo"
  - "La edición se envía con `If-Match` y queda en la auditoría"
created: 2026-10-13
updated: 2026-10-13
---

# TC-DEBT-LOAN-054 — Un préstamo en borrador se edita desde la pantalla y su vista previa se recalcula

## Intención

Hoy un borrador solo se edita por `PATCH` (docs/38 §4). La conducta ya está especificada en `add-loans` (en borrador todo es editable); este TC cubre la UI sin delta de spec (D219, D222).

## Escenario

```gherkin
Dado el borrador "Préstamo vehicular" a 24 cuotas
Cuando el EDITOR lo edita a 36 cuotas desde la pantalla
Entonces la vista previa muestra 36 cuotas
  Y no se crea ningún asiento
```

## Notas

- Ejecutar con `PF_E2E_PROJECT=pfos-e2e-<nombre>`.
