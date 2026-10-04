---
id: TC-ACCOUNTS-ARCHIVE-002
title: "Una cuenta archivada o cerrada rechaza movimientos nuevos, incluidas las anulaciones que la afectan"
spec: accounts/account-management
related_specs: ["transactions/transaction-recording", "ledger/journal-posting"]
requirement: "Cuenta archivada o cerrada no recibe movimientos"
scenario: "Anulación que afectaría una cuenta archivada"
requirement_status: confirmed
fr: [FR-ACCOUNTS-007]
nfr: []
invariants: [INV-026]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/application/accounts.service.test.ts
  - packages/contexts/accounts/src/domain/account.test.ts
  - packages/contexts/accounts/test/integration/pg-accounts.int.test.ts
  - apps/api/test/api/accounts-ledger.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["accounts", "archive", "ledger"]
error_code: "ACCOUNT_ARCHIVED"
preconditions:
  - "Old Bank (bank, BOB) con saldo 300.00 BOB, que incluye una transacción T9 de -50.00 BOB, y luego archivada"
  - "Bank B (savings, BOB) cerrada con saldo 0.00 BOB"
input:
  - {command: "Registrar gasto de 20.00 BOB en Old Bank", expected: "ACCOUNT_ARCHIVED"}
  - {command: "Anular T9", expected: "ACCOUNT_ARCHIVED"}
  - {command: "Registrar ingreso de 10.00 BOB en Bank B", expected: "ACCOUNT_CLOSED"}
  - {command: "Transferir 5.00 BOB de Bank A a Old Bank", expected: "ACCOUNT_ARCHIVED"}
steps:
  - "Ejecutar cada comando"
  - "Ejecutar en paralelo el archivo de una cuenta activa y un gasto sobre ella"
expected_result:
  - "Cada comando se rechaza con el código esperado (409)"
  - "No se crea ninguna transacción, asiento, reversa, auditoría ni evento; Old Bank sigue en 300.00 BOB y Bank B en 0.00 BOB"
  - "En la carrera, o el gasto se confirma antes del archivo, o se rechaza con ACCOUNT_ARCHIVED; nunca queda un posting posterior al archivo"
created: 2026-10-02
updated: 2026-10-04
---

# TC-ACCOUNTS-ARCHIVE-002 — Una cuenta archivada o cerrada rechaza movimientos nuevos, incluidas las anulaciones que la afectan

## Intención

INV-026: una cuenta retirada no debe cambiar de saldo en silencio; las reversas también son movimientos.

## Escenario

```gherkin
Dado "Old Bank" archivada con 300.00 BOB
Cuando el usuario anula una transacción de 50.00 BOB registrada en "Old Bank"
Entonces se rechaza con ACCOUNT_ARCHIVED
  Y no se crea ninguna reversa
```

## Notas

- Verificado 2026-10-04: rechazo por estado/moneda en dominio y aplicación, carrera con FOR SHARE en integración; la anulación contra Transactions real la cubre [TC-TRANSACTIONS-ARCHIVED-001].
- Ampliado 2026-10-04 (add-accounts-management 6.3): gasto, anulación de T9, ingreso en cuenta cerrada y transferencia hacia la archivada contra Transactions real (sin póster de prueba), con conteo de transacciones/asientos/auditoría/outbox, y la carrera archivo ↔ gasto por HTTP.
