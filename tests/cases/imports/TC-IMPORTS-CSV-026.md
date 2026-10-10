---
id: TC-IMPORTS-CSV-026
title: "Una descripción con fórmula se guarda literal y sale neutralizada en el CSV del export"
spec: imports/import-pipeline
related_specs: ["identity/workspace-portability"]
requirement: "Textos importados como datos no confiables"
scenario: "Fórmula en la descripción"
requirement_status: confirmed
fr: ["FR-IMPORTS-003"]
nfr: ["NFR-SEC-010","NFR-SEC-015"]
invariants: []
priority: critical
type: security
level: security
automation_status: automated
automated_tests:
  - apps/api/test/api/imports.api.test.ts
  - packages/contexts/imports/src/domain/row-normalizer.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["csv-import","csv-injection"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"description":"=HYPERLINK(\"http://example.test\",\"clic\")"}
steps:
  - "Importar una fila con esa descripción"
  - "Exportar el workspace y leer csv/transactions.csv"
  - "Importar una fila con descripción de 620 caracteres con tabulación y espacios repetidos"
  - "Revisar los logs del import"
expected_result:
  - "La transacción guarda la descripción literal"
  - "En el CSV la celda empieza con apóstrofo"
  - "La descripción larga queda en 500 caracteres sin tabulación ni espacios repetidos y con IMPORT_DESCRIPTION_TRUNCATED"
  - "Los logs no contienen montos ni descripciones"
created: 2026-10-09
updated: 2026-10-10
---

# TC-IMPORTS-CSV-026 — Una descripción con fórmula se guarda literal y sale neutralizada en el CSV del export

## Intención

docs/12 §7 y docs/13 §13: los textos importados son datos no confiables; la neutralización ocurre al exportar.

## Escenario

```gherkin
Dada una fila con la descripción =HYPERLINK(...)
Cuando la importo y exporto el workspace
Entonces la celda del CSV empieza con apóstrofo y no se interpreta como fórmula
```

## Notas

- Cubre también el scenario "Caracteres de control y descripción larga".
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
