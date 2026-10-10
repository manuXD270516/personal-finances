---
id: TC-IMPORTS-CSV-015
title: "La vista previa informa conteos, totales y saldo resultante sin crear transacciones ni asientos"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Vista previa sin efectos antes de aprobar"
scenario: "Resumen de la vista previa"
requirement_status: confirmed
fr: ["FR-IMPORTS-003","FR-IMPORTS-009"]
nfr: ["NFR-DATA-016"]
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/test/integration/pg-imports.int.test.ts
status: automated
regression_suite: false
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
  - "Subir y mapear extracto-octubre.csv"
  - "GET W/imports/{id}/preview"
  - "Re-enviar el mapeo con MM/dd/yyyy y volver a consultar"
expected_result:
  - "4 nuevas, 0 ya importadas, 0 posibles duplicados, 0 inválidas"
  - "outflows 281.30 BOB, inflows 8000.00 BOB, currentBalance 4000.00 BOB, resultingBalance 11718.70 BOB"
  - "Tras re-mapear: fechas recalculadas"
  - "En todo momento: 0 transacciones con import_job_id y saldo contable 4000.00 BOB"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-015 — La vista previa informa conteos, totales y saldo resultante sin crear transacciones ni asientos

## Intención

NFR-DATA-016: ninguna fila se persiste sin validación y aprobación; la vista previa es pura lectura.

## Escenario

```gherkin
Dado Banco BOB con 4000.00 BOB
Cuando mapeo extracto-octubre.csv
Entonces la vista previa informa salidas 281.30, entradas 8000.00 y saldo resultante 11718.70 BOB
  Y el saldo contable sigue en 4000.00 BOB sin transacciones importadas
```

## Notas

- Cubre también el scenario "Cambiar el mapeo antes de aprobar".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
