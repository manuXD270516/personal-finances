---
id: TC-AUDIT-LIFECYCLE-025
title: "El recorrido de una sesión de reconciliación muestra sus transiciones y anotaciones"
spec: audit/lifecycle-timeline
related_specs: ["transactions/reconciliation"]
requirement: "Recorrido de una sesión de reconciliación"
scenario: "Recorrido de una sesión finalizada con ajuste"
requirement_status: confirmed
fr: [FR-AUDIT-009, FR-AUDIT-010, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-029]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - packages/contexts/transactions/src/domain/reconciliation.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["lifecycle", "reconciliation"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión iniciada al 2026-03-31 por 3345.00 BOB"
input:
  - "{\"action\":\"toggle\",\"transaction\":\"G2\"}"
  - "{\"action\":\"complete\",\"adjustment\":{\"reason\":\"comisión\"}}"
  - "{\"action\":\"complete\",\"session\":\"CANCELLED\"}"
steps:
  - "Confirmar G2 en la sesión y finalizar con ajuste"
  - "GET W/reconciliations/{id}/lifecycle"
  - "GET W/lifecycle-machines/Reconciliation"
  - "Intentar finalizar una sesión CANCELLED"
expected_result:
  - "Transiciones START y COMPLETE en orden con statementBalance 3345.00, difference 0.00 y el ajuste enlazado"
  - "Anotación de la confirmación de G2"
  - "Máquina: IN_PROGRESS, COMPLETED y CANCELLED (terminales)"
  - "Sesión CANCELLED: 409 INVALID_STATUS_TRANSITION sin transición registrada"
created: 2026-10-05
updated: 2026-10-08
---

# TC-AUDIT-LIFECYCLE-025 — El recorrido de una sesión de reconciliación muestra sus transiciones y anotaciones

## Intención

D37: el nuevo agregado declara su máquina y su recorrido como cualquier otro.

## Escenario

```gherkin
Dado una sesión de "Bank A" iniciada, con un gasto confirmado y finalizada con ajuste
Cuando se consulta su recorrido
Entonces muestra iniciar y finalizar en orden con el ajuste enlazado
  Y la confirmación como anotación
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
