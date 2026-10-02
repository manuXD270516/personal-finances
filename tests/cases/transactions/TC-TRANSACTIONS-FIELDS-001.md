---
id: TC-TRANSACTIONS-FIELDS-001
title: "Todos los campos de una transacción se persisten y se devuelven sin cambios"
spec: transactions/transaction-recording
related_specs: ["classification/counterparties", "classification/tags"]
requirement: "Datos de la transacción"
scenario: "Ida y vuelta de todos los campos"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-002, FR-TRANSACTIONS-003]
nfr: []
invariants: [INV-001]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fields", "api"]
error_code: null
preconditions:
  - "EDITOR autenticado de W1"
  - "Bank A (BOB)"
  - "Contraparte \"Supermercado Demo\", tag \"familia\" y categoría \"Groceries\" activos"
input:
  kind: "EXPENSE"
  account: "Bank A"
  amount: "45.90"
  currency: "BOB"
  businessDate: "2026-03-10"
  postingDate: "2026-03-11"
  description: "Compra semanal"
  counterparty: "Supermercado Demo"
  notes: "con factura"
  split: "Groceries 45.90 con tag familia"
  externalRef: "bank-csv / TX-998"
steps: ["Crear la transacción", "Consultarla por id", "Listarla con filtro por contraparte"]
expected_result:
  - "La respuesta y la consulta devuelven businessDate 2026-03-10, postingDate 2026-03-11, descripción, notas, contraparte, split con categoría y tag, referencia externa y monto \"45.90\" BOB como string"
  - "source = MANUAL y status = POSTED"
  - "El listado filtrado por la contraparte la incluye"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-FIELDS-001 — Todos los campos de una transacción se persisten y se devuelven sin cambios

## Intención

Garantiza que el modelo de transacción de Phase 1 conserva todos los campos de FR-TRANSACTIONS-002/003 sin pérdida (montos como string decimal).

## Escenario

```gherkin
Dado un gasto de 45.90 BOB con todos sus campos opcionales informados
Cuando el usuario lo registra y luego lo consulta
Entonces cada campo devuelto es igual al enviado
  Y el origen es "manual"
```
