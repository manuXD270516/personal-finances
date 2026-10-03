---
id: TC-AUDIT-LIFECYCLE-002
title: "El registro de transición se escribe atómicamente con el posteo"
spec: audit/lifecycle-timeline
related_specs: ["audit/audit-trail","transactions/transaction-recording"]
requirement: "Registro de transición atómico con el cambio"
scenario: "Posteo con su transición"
requirement_status: confirmed
fr: ["FR-AUDIT-009","FR-AUDIT-001"]
nfr: ["NFR-DATA-007"]
invariants: ["INV-029","INV-023"]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["lifecycle","atomicity"]
error_code: null
preconditions:
  - "\"Bank A\" con saldo 1000.00 BOB"
  - "Gasto pendiente de 75.00 BOB en \"Bank A\""
input: {"command":"PostTransaction","faultInjection":"falla la inserción en el registro de transiciones (segunda corrida)"}
steps:
  - "Postear el gasto"
  - "Repetir con otro gasto pendiente inyectando un fallo al escribir la transición"
expected_result:
  - "Primera corrida: existen el asiento, la auditoría, el evento TransactionPosted y una transición POST pending → posted que referencia el asiento y el auditLogId"
  - "Segunda corrida: el comando falla, la transacción sigue pending, sin asiento ni evento, y el saldo no cambia"
created: 2026-10-03
updated: 2026-10-03
---

# TC-AUDIT-LIFECYCLE-002 — El registro de transición se escribe atómicamente con el posteo

## Intención

Una transición que pudiera perderse o quedar huérfana haría que el recorrido mienta; se escribe en la misma UoW que el cambio (INV-029).

## Escenario

```gherkin
Dado un gasto pendiente de 75.00 BOB en "Bank A" con 1000.00 BOB
Cuando lo posteo
Entonces existen juntos el asiento, la auditoría, el evento y la transición pending → posted
  Y si la transición no se puede escribir, nada se persiste
```

## Notas

