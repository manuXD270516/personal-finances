---
id: TC-CLASSIFICATION-RECATEGORIZE-001
title: "Recategorizar una transacción no afecta el ledger"
spec: classification/categories
related_specs: ["transactions/splits", "ledger/journal-posting"]
requirement: "Recategorización fuera del ledger"
scenario: null
requirement_status: provisional
fr: [FR-CLASSIFICATION-002]
nfr: []
invariants: [INV-004]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["classification", "ledger"]
error_code: null
preconditions:
  - "Gasto contabilizado T1 de 150.00 BOB, categoría Groceries, asiento E1 con postings P1/P2"
  - "El periodo de T1 está abierto"
input:
  transaction: "T1"
  from: "Groceries"
  to: "Household"
steps:
  - "Recategorizar T1"
  - "Contar asientos y postings; comparar las filas P1/P2"
  - "Consultar los totales por categoría del mes"
expected_result:
  - "El número de asientos y postings no cambia; las filas P1/P2 son idénticas byte a byte"
  - "Categoría del split = Household"
  - "Totales del mes: Groceries -150.00, Household +150.00 respecto de antes"
  - "Registro en la bitácora de auditoría con la categoría anterior/posterior"
  - "Se emite el evento classification/transactions recategorized para las proyecciones de reportes"
created: 2026-10-01
updated: 2026-10-01
---

# TC-CLASSIFICATION-RECATEGORIZE-001 — Recategorizar una transacción no afecta el ledger

## Intención

ARCHITECTURE §4.1: la clasificación vive en TransactionSplit; recategorizar nunca crea asientos en el ledger.

## Escenario

```gherkin
Dado un gasto contabilizado de 150.00 BOB categorizado como Groceries
Cuando el usuario cambia su categoría a Household
Entonces no se crea ni modifica ningún asiento ni posting
  Y el gasto aparece bajo Household en el reporte del mes
```

## Notas

- Pregunta abierta: ¿se permite recategorizar en un periodo cerrado (cambia los reportes pero no el ledger)? Ver INV-015 en docs/09.
