---
id: TC-TRANSACTIONS-DEDUPE-004
title: "Dos importaciones simultáneas con el mismo identificador dejan una sola transacción viva"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Una transacción viva por identificador externo"
scenario: "Mismo identificador en dos importaciones simultáneas"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032", "FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "duplicate-detection"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Mismo identificador en dos importaciones simultáneas\" del delta de add-import-pipeline"
steps:
  - "dos importaciones de \"Banco BOB\" aprobadas a la vez traen el movimiento con identificador \"2026030100017\""
expected_result:
  - "existe una sola transacción no anulada con esa referencia en \"Banco BOB\""
  - "la otra importación lo informa como ya importado"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-DEDUPE-004 — Dos importaciones simultáneas con el mismo identificador dejan una sola transacción viva

## Intención

Transactions DEBE (MUST) garantizar que en una cuenta exista a lo sumo una transacción no anulada por cada referencia externa importada (espacio de nombres de la institución y el formato, más el identificador), también cuando dos importaciones con la misma referencia se persisten a la vez; anular esa transacción DEBE (MUST) liberar la referencia para un import posterior.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando dos importaciones de "Banco BOB" aprobadas a la vez traen el movimiento con identificador "2026030100017"
Entonces existe una sola transacción no anulada con esa referencia en "Banco BOB"
  Y la otra importación lo informa como ya importado
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
