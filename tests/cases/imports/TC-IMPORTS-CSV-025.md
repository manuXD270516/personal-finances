---
id: TC-IMPORTS-CSV-025
title: "Cancelar una importación en revisión no crea transacciones y una completada no se puede cancelar"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Cancelación de una importación"
scenario: "Cancelar durante la revisión"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/application/imports.service.test.ts
  - packages/contexts/imports/src/domain/import-job.test.ts
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
input: {}
steps:
  - "POST cancel sobre una importación AWAITING_REVIEW con 4 filas nuevas"
  - "POST cancel sobre una importación COMPLETED"
expected_result:
  - "Primera: CANCELLED, 0 transacciones, staging descartado, auditoría"
  - "Segunda: 409 INVALID_STATUS_TRANSITION"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-025 — Cancelar una importación en revisión no crea transacciones y una completada no se puede cancelar

## Intención

Cancelar es seguro antes de aprobar; después, el camino es anular (o deshacer en Phase 6).

## Escenario

```gherkin
Dada una importación en revisión
Cuando la cancelo
Entonces queda cancelada sin transacciones
Dada una importación completada
Cuando intento cancelarla
Entonces se rechaza con INVALID_STATUS_TRANSITION
```

## Notas

- Cubre también el scenario "Cancelar una importación completada".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
