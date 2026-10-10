---
id: TC-IMPORTS-CSV-002
title: "Subir un CSV para una cuenta cerrada se rechaza con ACCOUNT_CLOSED"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Importación CSV para una cuenta"
scenario: "Cuenta cerrada"
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
status: automated
regression_suite: false
phase: 3
tags: ["csv-import"]
error_code: ACCOUNT_CLOSED
preconditions:
  - "Workspace \"W1\""
  - "Cuenta \"Banco Viejo\" cerrada"
input: {"accountId":"Banco Viejo"}
steps:
  - "POST W/imports con un CSV válido para \"Banco Viejo\""
expected_result:
  - "409 ACCOUNT_CLOSED"
  - "No existe ninguna importación nueva"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-002 — Subir un CSV para una cuenta cerrada se rechaza con ACCOUNT_CLOSED

## Intención

Las cuentas no activas no admiten movimientos (transactions/transaction-recording); el import no es un atajo.

## Escenario

```gherkin
Dada la cuenta cerrada Banco Viejo
Cuando subo un CSV para ella
Entonces se rechaza con ACCOUNT_CLOSED
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
