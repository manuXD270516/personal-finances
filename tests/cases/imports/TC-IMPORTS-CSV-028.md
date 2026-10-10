---
id: TC-IMPORTS-CSV-028
title: "La subida 11 en un minuto responde 429 y un replay de aprobación no consume cuota costosa"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Cuota de operaciones costosas en el import"
scenario: "Ráfaga de subidas"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-SEC-011"]
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import","rate-limit","D113"]
error_code: RATE_LIMITED
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"uploads":11,"quotaPerMinute":10}
steps:
  - "Subir 11 archivos con claves distintas en menos de un minuto"
  - "Repetir una aprobación con la misma clave y contenido"
expected_result:
  - "Subida 11: 429 RATE_LIMITED con Retry-After, sin importación"
  - "Replay: respuesta original sin consumir cuota costosa"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-028 — La subida 11 en un minuto responde 429 y un replay de aprobación no consume cuota costosa

## Intención

docs/33 D113: las operaciones costosas tienen cuota propia de 10/min; el import es una de ellas.

## Escenario

```gherkin
Cuando subo 11 archivos en menos de un minuto
Entonces la subida 11 responde 429 RATE_LIMITED
  Y no se crea esa importación
```

## Notas

- Cubre también el scenario "Reproducción de una aprobación".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
