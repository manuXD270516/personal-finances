---
id: TC-AUDIT-ATOMIC-001
title: "La bitácora de auditoría se escribe en la misma transacción de base de datos que la mutación financiera"
spec: audit/audit-trail
related_specs: ["transactions/transaction-recording"]
requirement: "Registro de auditoría atómico con la mutación"
scenario: "Falla al escribir la auditoría"
requirement_status: confirmed
fr: [FR-AUDIT-001]
nfr: [NFR-DATA-007]
invariants: [INV-029]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["audit", "atomicity", "outbox"]
error_code: "INTERNAL_ERROR"
preconditions:
  - "PostgreSQL mediante Testcontainers"
  - "Minimal Seed: Bank A (bank, BOB) con saldo 1000.00"
  - "Adaptador AuditPort con inyección de fallas que falla a demanda"
input:
  command: "RecordExpense 75.00 BOB en Bank A"
  fault: "la inserción de auditoría lanza una excepción"
steps:
  - "Ejecutar el comando normalmente"
  - "Ejecutarlo nuevamente con la falla de auditoría habilitada"
  - "Ejecutar un comando inválido (gasto de 50.00 BOB en USD Savings)"
expected_result:
  - "Normal: la transacción, el asiento, exactamente una fila de auditoría y el evento de outbox se confirman juntos; saldo de Bank A = 925.00 BOB"
  - "Falla: el comando responde INTERNAL_ERROR y no existe ninguno de transacción, asiento, fila de auditoría ni evento de outbox (rollback único)"
  - "Comando inválido: no se escribe fila de auditoría"
  - "El saldo de Bank A refleja solo el comando exitoso (925.00 BOB)"
created: 2026-10-01
updated: 2026-10-02
---

# TC-AUDIT-ATOMIC-001 — La bitácora de auditoría se escribe en la misma transacción de base de datos que la mutación financiera

## Intención

ARCHITECTURE §7 e INV-029: la auditoría de las mutaciones financieras es síncrona y atómica, nunca eventual. Sin este caso un fallo de auditoría podría dejar cambios financieros sin rastro.

## Escenario

```gherkin
Dado que "Bank A" tiene 1000.00 BOB
  Y el almacén de auditoría falla
Cuando el usuario registra un gasto de 75.00 BOB en "Bank A"
Entonces el gasto no se registra
  Y no existe ningún asiento, registro de auditoría ni evento de outbox para él
  Y el saldo de "Bank A" sigue en 1000.00 BOB
```

## Notas

- Hasta que exista `add-transaction-recording`, el test usa un comando de prueba con el mismo flujo de unidad de trabajo (design.md de add-audit-trail).
