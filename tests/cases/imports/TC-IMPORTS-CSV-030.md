---
id: TC-IMPORTS-CSV-030
title: "Las celdas crudas se purgan a los 90 días y una revisión abandonada expira a los 30"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Retención del contenido importado"
scenario: "Purga a los 90 días"
requirement_status: confirmed
fr: ["FR-IMPORTS-003","FR-IMPORTS-010"]
nfr: []
invariants: ["INV-014"]
priority: medium
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
tags: ["csv-import","retention"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"completedAt":"2026-10-20","awaitingSince":"2026-10-20"}
steps:
  - "Ejecutar imports.purge-staging con FixedClock 2027-01-18"
  - "Ejecutar imports.expire-reviews con FixedClock 2026-11-19"
expected_result:
  - "Import completado el 2026-10-20: sin filas de staging; import_job, conteos y row_link conservados; reimportar sigue dando 0 nuevas"
  - "Import en revisión desde el 2026-10-20: CANCELLED por SYSTEM con auditoría y staging descartado"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-030 — Las celdas crudas se purgan a los 90 días y una revisión abandonada expira a los 30

## Intención

RISK-010: el contenido del extracto no se guarda más de lo necesario, sin perder la idempotencia.

## Escenario

```gherkin
Dado un import completado el 2026-10-20
Cuando llega el 2027-01-18
Entonces sus celdas crudas ya no existen y sus vínculos de idempotencia se conservan
Dado un import en revisión desde el 2026-10-20
Cuando llega el 2026-11-19
Entonces queda cancelado por el sistema con auditoría
```

## Notas

- Cubre también el scenario "Revisión abandonada".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
