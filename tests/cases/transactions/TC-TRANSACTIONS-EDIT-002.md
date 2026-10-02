---
id: TC-TRANSACTIONS-EDIT-002
title: "Editar descripción, notas, contraparte o tags no toca el ledger y queda auditado"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting", "audit/audit-trail"]
requirement: "Edición de datos descriptivos sin impacto en el ledger"
scenario: "Cambiar la contraparte de un gasto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-008]
nfr: []
invariants: [INV-033, INV-007]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["edit", "classification"]
error_code: null
preconditions:
  - "Gasto posteado T1 de 150.00 BOB en Bank A con asiento E1, versión 3"
  - "Bank A con saldo 850.00 BOB"
input:
  transaction: "T1"
  description: "Supermercado (corregido)"
  counterparty: "Supermercado Demo"
  notes: "compra quincenal"
  if_match_version: 3
steps: ["Aplicar la edición", "Contar asientos/postings y comparar E1", "Consultar historial"]
expected_result:
  - "Número de asientos y postings sin cambios; filas de E1 idénticas"
  - "Saldo de Bank A = 850.00 BOB; revisión sin cambios; versión 4"
  - "Auditoría con diff antes/después de descripción, contraparte y notas"
  - "No se publica TransactionPosted"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-EDIT-002 — Editar descripción, notas, contraparte o tags no toca el ledger y queda auditado

## Intención

La clasificación y los textos viven fuera del ledger (INV-033); cambiarlos no puede generar reversas.

## Escenario

```gherkin
Dado un gasto posteado de 150.00 BOB
Cuando el usuario cambia su contraparte y descripción
Entonces no se crea ningún asiento
  Y el historial registra los valores anterior y nuevo
```
