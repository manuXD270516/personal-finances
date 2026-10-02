---
id: TC-AUDIT-ATOMIC-001
title: "La bitácora de auditoría se escribe en la misma transacción de base de datos que la mutación financiera"
spec: audit/audit-trail
related_specs: ["transactions/transaction-recording"]
requirement: "Pista de auditoría transaccional"
scenario: null
requirement_status: provisional
fr: [FR-AUDIT-001]
nfr: []
invariants: [INV-015]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["audit", "atomicity", "outbox"]
error_code: null
preconditions:
  - "PostgreSQL mediante Testcontainers"
  - "Adaptador AuditPort con inyección de fallas que falla a demanda"
input:
  command: "RecordExpense 75.00 BOB en Bank A"
  fault: "la inserción de auditoría lanza una excepción"
steps:
  - "Ejecutar el comando normalmente"
  - "Ejecutarlo nuevamente con la falla de auditoría habilitada"
expected_result:
  - "Normal: la transacción, el asiento, la fila de auditoría y el evento de outbox se confirman juntos"
  - "Falla: el comando falla y no existe ninguno de transacción, asiento, fila de auditoría ni evento de outbox (rollback único)"
  - "El saldo de Bank A refleja solo el comando exitoso"
created: 2026-10-01
updated: 2026-10-01
---

# TC-AUDIT-ATOMIC-001 — La bitácora de auditoría se escribe en la misma transacción de base de datos que la mutación financiera

## Intención

ARCHITECTURE §7: la auditoría de las mutaciones financieras es síncrona y atómica, nunca eventual.

## Escenario

```gherkin
Dado que el almacén de auditoría falla
Cuando el usuario registra un gasto
Entonces el gasto no se registra
  Y no existe ningún asiento ni evento de outbox para él
```
