---
id: TC-AUDIT-LIFECYCLE-001
title: "La máquina de estados declarada rechaza transiciones no declaradas"
spec: audit/lifecycle-timeline
related_specs: ["transactions/transaction-recording","accounts/account-management"]
requirement: "Máquina de estados declarada por agregado"
scenario: "Transición no declarada"
requirement_status: confirmed
fr: ["FR-AUDIT-009","FR-TRANSACTIONS-006","FR-ACCOUNTS-007"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle.api.test.ts
  - packages/contexts/accounts/src/domain/account-lifecycle.test.ts
  - packages/contexts/transactions/src/application/lifecycle.service.test.ts
  - packages/contexts/transactions/src/domain/transaction-lifecycle.test.ts
  - packages/contexts/transactions/src/infrastructure/lifecycle.architecture.test.ts
  - packages/shared-kernel/src/lifecycle/lifecycle-machine.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle","state-machine"]
error_code: INVALID_STATUS_TRANSITION
preconditions:
  - "Gasto pendiente de 80.00 BOB en \"Bank A\""
input: {"transition":"RECONCILE","from":"pending"}
steps:
  - "Consultar la definición de la máquina Transaction"
  - "Intentar reconciliar el gasto pendiente"
expected_result:
  - "La definición lista pending, posted, cleared, reconciled y void (void terminal) y las transiciones RECORD, POST, CLEAR, UNCLEAR, RECONCILE, UNRECONCILE, REVISE y VOID con origen, destino, guarda y eventos"
  - "La reconciliación se rechaza con INVALID_STATUS_TRANSITION"
  - "No se registra ninguna transición y el gasto sigue pending"
created: 2026-10-03
updated: 2026-10-04
---

# TC-AUDIT-LIFECYCLE-001 — La máquina de estados declarada rechaza transiciones no declaradas

## Intención

La máquina declarada es la única fuente de las reglas de transición (docs/31 D37); el agregado y el recorrido usan la misma definición.

## Escenario

```gherkin
Dado un gasto pendiente de 80.00 BOB
Cuando intento reconciliarlo
Entonces se rechaza con INVALID_STATUS_TRANSITION
  Y no se registra ninguna transición
```

## Notas

- Cubre también el scenario "Definición de la máquina de una transacción".
- Variante de cuentas: archivar una cuenta ya archivada ⇒ INVALID_STATUS_TRANSITION.
- Implementación (2026-10-04): los estados usan los códigos del contrato (`PENDING`, `POSTED`, `CLEARED`, `RECONCILED`, `VOIDED`); `RECORD` declara varios destinos (`to: [PENDING, POSTED, CLEARED]`). La máquina vive en el dominio de cada contexto (`TRANSACTION_LIFECYCLE`, `ACCOUNT_LIFECYCLE`, `EXCHANGE_RATE_LIFECYCLE`) sobre `LifecycleMachine` del shared-kernel; PBT con fast-check (transacciones) y enumeración exhaustiva (cuentas) verifican que todo estado persistido se alcanza por transiciones declaradas.
