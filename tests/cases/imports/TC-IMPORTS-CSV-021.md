---
id: TC-IMPORTS-CSV-021
title: "Omitir un posible duplicado lo vincula y una reimportación lo clasifica como ya importado"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Deduplicación básica con movimientos existentes"
scenario: "Omitir recuerda el vínculo"
requirement_status: provisional
fr: ["FR-IMPORTS-007","FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014"]
priority: high
type: domain
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"decision":"SKIP"}
steps:
  - "Decidir SKIP en la fila del supermercado del TC-IMPORTS-CSV-020 y aprobar"
  - "Subir de nuevo el mismo archivo"
expected_result:
  - "Primera importación: la fila no se crea; row_link SKIPPED_AS_DUPLICATE al gasto manual"
  - "Segunda: la fila es DUPLICATE_EXACT"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-021 — Omitir un posible duplicado lo vincula y una reimportación lo clasifica como ya importado

## Intención

docs/13 §7.4: el sistema aprende el par para no volver a preguntar.

## Escenario

```gherkin
Dada la fila del supermercado omitida como duplicado
Cuando reimporto el archivo
Entonces esa fila aparece como ya importada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
