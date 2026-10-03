---
id: TC-AUDIT-LIFECYCLE-003
title: "Corregir el monto de un gasto registra la transición de revisión con sus asientos"
spec: audit/lifecycle-timeline
related_specs: ["transactions/transaction-recording","ledger/journal-posting"]
requirement: "Edición financiera como transición de revisión"
scenario: "Corregir el monto de un gasto"
requirement_status: confirmed
fr: ["FR-AUDIT-009","FR-TRANSACTIONS-008","FR-LEDGER-005"]
nfr: []
invariants: ["INV-007","INV-008"]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["lifecycle","revision","reversal"]
error_code: null
preconditions:
  - "\"Bank A\" con 1000.00 BOB antes del gasto"
  - "Gasto posteado de 120.00 BOB en revisión 1 (asiento E1)"
input: {"amount":"102.00","currency":"BOB","expectedVersion":1}
steps:
  - "Editar el monto del gasto a 102.00 BOB"
  - "Consultar el recorrido y el saldo"
expected_result:
  - "Transición REVISE posted → posted, revisionFrom 1, revisionTo 2"
  - "journalEntries: reversed = E1, reversal = reversa de E1, posted = asiento nuevo de 102.00 BOB"
  - "Saldo de \"Bank A\" 898.00 BOB"
created: 2026-10-03
updated: 2026-10-03
---

# TC-AUDIT-LIFECYCLE-003 — Corregir el monto de un gasto registra la transición de revisión con sus asientos

## Intención

La edición deja de ser "una actualización del registro" y pasa a ser un paso explícito del flujo con su rastro contable (D37).

## Escenario

```gherkin
Dado un gasto posteado de 120.00 BOB en revisión 1
Cuando corrijo su monto a 102.00 BOB
Entonces el recorrido muestra la transición revisar de la revisión 1 a la 2 con los tres asientos
  Y el saldo de "Bank A" es 898.00 BOB
```

## Notas

- 1000.00 − 102.00 = 898.00; la reversa niega exactamente E1 (INV-008).
