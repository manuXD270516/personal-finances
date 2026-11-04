---
id: TC-IMPORTS-PDF-040
title: "Un extracto en bolivianos sobre una cuenta en USD deja todas las filas inválidas"
spec: imports/import-pipeline
related_specs: []
requirement: "Cuenta y moneda del extracto PDF verificadas"
scenario: "Moneda del extracto distinta de la cuenta"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-SEC-015"]
nfr: ["NFR-SEC-015"]
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/import-pdf.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: IMPORT_CURRENCY_MISMATCH
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
  - "Cuenta \"Caja USD\" (ASSET, activa, USD)"
input: "Datos del scenario \"Moneda del extracto distinta de la cuenta\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto declara \"EXPRESADO EN BOLIVIANOS\" y la cuenta destino \"Caja USD\" está en USD"
expected_result:
  - "todas sus filas quedan inválidas con `IMPORT_CURRENCY_MISMATCH`"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-040 — Un extracto en bolivianos sobre una cuenta en USD deja todas las filas inválidas

## Intención

El sistema DEBE (MUST) comparar los últimos 4 dígitos del número de cuenta del encabezado del extracto con los registrados en la cuenta destino y, si difieren, dejar la importación en "falló la lectura" con `IMPORT_PDF_ACCOUNT_MISMATCH`, sin filas; si la cuenta no tiene esos dígitos registrados, DEBE (MUST) procesarla con la advertencia `IMPORT_PDF_ACCOUNT_UNVERIFIED`. Si la moneda del extracto no es la de la cuenta, todas las filas DEBEN (MUST) quedar inválidas con `IMPORT_CURRENCY_MISMATCH`. Los demás datos del encabezado —titular, dirección, operador, sucursal— y el número de cuenta completo NO DEBEN (MUST NOT) guardarse en la importación, en sus filas, en la auditoría, en los eventos ni en los logs.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
  Y Cuenta "Caja USD" (ASSET, activa, USD)
Cuando el extracto declara "EXPRESADO EN BOLIVIANOS" y la cuenta destino "Caja USD" está en USD
Entonces todas sus filas quedan inválidas con `IMPORT_CURRENCY_MISMATCH`
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
