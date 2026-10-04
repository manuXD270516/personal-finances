---
id: TC-AUDIT-LIFECYCLE-005
title: "El recorrido de un gasto lista todas sus transiciones en orden con el camino de estados"
spec: audit/lifecycle-timeline
related_specs: ["transactions/transaction-recording","transactions/reconciliation"]
requirement: "Consulta del recorrido de un elemento"
scenario: "Recorrido completo de un gasto"
requirement_status: confirmed
fr: ["FR-AUDIT-010","FR-AUDIT-004"]
nfr: []
invariants: ["INV-023"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle.api.test.ts
  - packages/contexts/audit/src/application/lifecycle.test.ts
  - packages/contexts/transactions/src/application/lifecycle.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle","api"]
error_code: null
preconditions:
  - "\"Bank A\" con 1000.00 BOB"
  - "FixedClock 2026-03-10T10:00:00-04:00, avanzando 1 h por paso"
input: {"sequence":["RECORD pending 80.00 BOB","POST","CLEAR","REVISE 85.00 BOB","VOID motivo duplicado"]}
steps:
  - "Ejecutar la secuencia"
  - "GET W/transactions/{id}/lifecycle"
expected_result:
  - "items con 5 transiciones en orden de sequence: RECORD (∅ → pending), POST (pending → posted), CLEAR (posted → cleared), REVISE (cleared → posted, revisión 1 → 2), VOID (posted → void, reason \"duplicado\")"
  - "currentState void; path [pending, posted, cleared, posted, void]"
  - "Cada transición trae actor, occurredAt, origin y auditLogId; machine es la definición de Transaction"
  - "Saldo final de \"Bank A\" 1000.00 BOB"
created: 2026-10-03
updated: 2026-10-04
---

# TC-AUDIT-LIFECYCLE-005 — El recorrido de un gasto lista todas sus transiciones en orden con el camino de estados

## Intención

Es la consulta central de D37: el camino completo que tomó un elemento.

## Escenario

```gherkin
Dado un gasto de 80.00 BOB registrado pendiente, posteado, cleared, corregido a 85.00 BOB y anulado
Cuando consulto su recorrido
Entonces obtengo cinco transiciones en orden
  Y el estado actual es void
```

## Notas

- El saldo vuelve a 1000.00 BOB porque la anulación revierte el asiento activo de 85.00 BOB.
- Implementación (2026-10-04): estados con los códigos del contrato; la API también devuelve `revisions[]` con el monto de cada revisión (80.00 y 85.00 BOB).
