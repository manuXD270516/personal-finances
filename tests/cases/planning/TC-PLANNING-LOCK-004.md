---
id: TC-PLANNING-LOCK-004
title: En un periodo cerrado se rechazan las ediciones de clasificación y estado y se permiten las descriptivas
spec: planning/month-closing
related_specs:
  - transactions/transaction-recording
  - transactions/bulk-edit
  - transactions/reconciliation
  - classification/custom-fields
requirement: Alcance de la edición en periodos cerrados
scenario: Clasificación de un gasto de un mes cerrado
requirement_status: confirmed
fr:
  - FR-PLANNING-005
  - FR-TRANSACTIONS-033
  - FR-CLASSIFICATION-009
nfr: []
invariants:
  - INV-015
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
  - apps/api/test/api/month-closing.api.test.ts
  - packages/contexts/transactions/src/application/bulk-edit.service.test.ts
  - packages/contexts/transactions/src/application/closed-period.service.test.ts
status: automated
regression_suite: true
phase: 2
tags:
  - month-closing
  - closed-period
  - d49
error_code: PERIOD_CLOSED
preconditions:
  - '"2026-10" (del 2026-10-01 al 2026-10-31) está closed con el snapshot 1'
  - 'Gasto posteado y cleared de "80.00" BOB del 2026-10-10 en "Bank A", categoría "Restaurantes", sin tags, contraparte "Café Central"'
input:
  amount: '80.00'
  currency: BOB
  businessDate: 2026-10-10
steps:
  - Agregar el tag "viaje" al gasto
  - Cambiar la contraparte a "Panadería Norte"
  - Cambiar un custom field de transacción del gasto
  - Desmarcar el gasto como confirmado
  - Repetir el cambio de tag en una edición masiva junto con un gasto del 2026-11-02
  - Cambiar las notas y la descripción del gasto
expected_result:
  - Las cinco primeras ediciones se rechazan con PERIOD_CLOSED, sin cambios ni auditoría (la masiva completa, señalando el gasto del 2026-10-10)
  - El cambio de notas y descripción se acepta y queda auditado
  - 'El saldo de "Bank A" al 2026-10-31 y el snapshot vigente de "2026-10" no cambian'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-LOCK-004 — En un periodo cerrado se rechazan las ediciones de clasificación y estado y se permiten las descriptivas

## Intención

Fija el alcance único de la edición en periodos cerrados (extensión de docs/31 D49, consolidación de Phase 2): todo lo que alimenta reportes, presupuestos por tag o contraparte y el estado de conciliación del snapshot queda congelado; lo descriptivo no afecta cifras y sigue editable. Las reglas de `add-reconciliation`, `add-bulk-edit` y `add-custom-fields` referencian este requirement.

## Escenario

```gherkin
Dado "2026-10" cerrado y un gasto de 80.00 BOB del 2026-10-10
Cuando se intenta cambiar tags, contraparte, custom fields o el estado de confirmación
Entonces cada intento se rechaza con PERIOD_CLOSED
Cuando se cambian las notas y la descripción
Entonces se acepta con auditoría y el snapshot no cambia
```

## Notas

- Cubre también el scenario "Ediciones descriptivas en un mes cerrado".
- Adjuntos y medio de pago se verifican cuando existan sus capabilities (`documents/attachments`, Phase 6).
