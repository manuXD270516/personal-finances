---
id: TC-IMPORTS-CSV-016
title: "Reimportar el mismo archivo clasifica todas las filas como ya importadas y crea 0 transacciones"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Idempotencia por fila"
scenario: "Mismo archivo dos veces"
requirement_status: provisional
fr: ["FR-IMPORTS-010","FR-IMPORTS-007"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 3
tags: ["csv-import"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"file":"extracto-octubre.csv"}
steps:
  - "Importar y aprobar extracto-octubre.csv (4 creadas; saldo 11718.70 BOB)"
  - "Subirlo de nuevo con el mismo mapeo y aprobar"
  - "PBT: ∀ archivo f, import(f); import(f) ⇒ #transacciones = import(f) una vez"
expected_result:
  - "Segunda vista previa: 4 ya importadas, 0 nuevas"
  - "Segunda aprobación: 0 creadas"
  - "Saldo de Banco BOB 11718.70 BOB"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-016 — Reimportar el mismo archivo clasifica todas las filas como ya importadas y crea 0 transacciones

## Intención

INV-014 / exit criterion de imports: re-subir el mismo archivo no crea duplicados.

## Escenario

```gherkin
Dado extracto-octubre.csv ya importado
Cuando lo subo de nuevo y apruebo
Entonces se crean 0 transacciones y el saldo sigue en 11718.70 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
