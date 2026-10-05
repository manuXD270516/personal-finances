---
id: TC-CLASSIFICATION-RECATEGORIZE-001
title: Recategorizar una transacción no afecta el ledger
spec: classification/categories
related_specs: [transactions/splits, ledger/journal-posting]
requirement: Recategorizar no modifica el ledger
scenario: Recategorizar un gasto contabilizado
requirement_status: confirmed
fr: [FR-LEDGER-008, FR-TRANSACTIONS-008]
nfr: []
invariants: [INV-033]
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-ledger.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: [classification, ledger, regression]
error_code: null
preconditions:
- Cuenta "Banco BOB" con saldo 2,000.00 BOB después de registrar el gasto
- Gasto contabilizado T1 de 150.00 BOB desde "Banco BOB", categoría "Supermercado", asiento E1 con postings P1/P2
- El periodo de T1 está abierto
input:
  transaction: T1
  from: Supermercado
  to: Hogar
steps:
- Contar asientos y postings y leer el saldo de "Banco BOB"
- Recategorizar T1
- Volver a contar asientos y postings; comparar las filas P1/P2
- Consultar los totales por categoría del mes
expected_result:
- El número de asientos y postings no cambia; P1/P2 son idénticos
- El saldo de "Banco BOB" sigue siendo 2,000.00 BOB
- Categoría de la porción = "Hogar"
- 'Totales del mes: "Supermercado" -150.00 BOB y "Hogar" +150.00 BOB respecto de antes'
- Registro de auditoría con la categoría anterior y la nueva
- Se emite transactions.TransactionCategorized.v1
created: 2026-10-01
updated: 2026-10-04
---

# TC-CLASSIFICATION-RECATEGORIZE-001 — Recategorizar una transacción no afecta el ledger

## Intención

INV-033 (ARCHITECTURE §4.1): la clasificación vive en la porción; recategorizar nunca crea, modifica ni revierte asientos.

## Escenario

```gherkin
Dado un gasto contabilizado de 150.00 BOB categorizado como "Supermercado"
  Y el saldo de "Banco BOB" es 2,000.00 BOB
Cuando el usuario cambia su categoría a "Hogar"
Entonces no se crea ni modifica ningún asiento ni posting
  Y el saldo de "Banco BOB" sigue siendo 2,000.00 BOB
  Y el gasto aparece bajo "Hogar" en el reporte del mes
```

## Notas

- Recategorizar en periodo cerrado (INV-015) no aplica en Phase 1; se decide con planning/month-closing (Phase 2).
- Se automatiza cuando exista add-transaction-recording (tasks 7.1).
- Automatizado 2026-10-04 (add-classification 7.1) por HTTP contra Transactions, Ledger y Reporting reales: huella fila a fila de asientos/postings, saldo, totales del mes por categoría, auditoría y `TransactionCategorized.v1` validado.
