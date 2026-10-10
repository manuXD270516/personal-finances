---
id: TC-IMPORTS-CSV-024
title: "Un lote rechazado por periodo cerrado deja el import parcial y el reintento crea solo las filas faltantes"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Fallo parcial y reintento"
scenario: "Periodo cerrado entre la vista previa y la persistencia"
requirement_status: provisional
fr: ["FR-IMPORTS-003","FR-PLANNING-005","FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014","INV-015"]
priority: high
type: integration
level: application
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
input: {"rows":450,"batchSize":200}
steps:
  - "Aprobar un import de 450 filas (lotes 200, 200, 50)"
  - "Cerrar \"2026-09\" antes de que se persista el lote 2 (200 filas de septiembre)"
  - "Reabrir \"2026-09\" (OWNER) y reintentar"
  - "Variante: aceptar el resultado parcial sin reintentar"
expected_result:
  - "Tras la persistencia: 250 creadas; PARTIALLY_FAILED con 200 filas PERIOD_CLOSED"
  - "Tras el reintento: 450 creadas, COMPLETED, ninguna duplicada"
  - "Variante: COMPLETED_WITH_ERRORS con 250 creadas y 200 fallidas listadas"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-024 — Un lote rechazado por periodo cerrado deja el import parcial y el reintento crea solo las filas faltantes

## Intención

Un lote es una transacción de BD; su fallo no revierte los demás y el reintento es idempotente (docs/13 §4.1 Persist).

## Escenario

```gherkin
Dado un import aprobado de 450 filas en lotes de 200, 200 y 50
  Y el periodo 2026-09 se cierra antes del lote 2
Entonces se crean 250 y el import queda parcialmente fallido
Cuando reabro 2026-09 y reintento
Entonces se crean las 200 restantes sin duplicar ninguna
```

## Notas

- Cubre también el scenario "Aceptar el resultado parcial".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
