---
id: TC-IMPORTS-PDF-041
title: "El titular, el operador y el número de cuenta completo del encabezado no se guardan ni se registran"
spec: imports/import-pipeline
related_specs: []
requirement: "Cuenta y moneda del extracto PDF verificadas"
scenario: "Datos del titular descartados"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-SEC-015"]
nfr: ["NFR-SEC-015"]
invariants: []
priority: critical
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Datos del titular descartados\" del delta de add-pdf-statement-parser"
steps:
  - "el encabezado del extracto trae \"CLIENTE: TITULAR FICTICIO UNO DEMO\", \"Procesado por 00000001\" y la cuenta \"0000000001\""
expected_result:
  - "ni el nombre del titular, ni el operador, ni el número de cuenta completo aparecen en la importación, sus filas, la auditoría, los eventos ni los logs"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-041 — El titular, el operador y el número de cuenta completo del encabezado no se guardan ni se registran

## Intención

El sistema DEBE (MUST) comparar los últimos 4 dígitos del número de cuenta del encabezado del extracto con los registrados en la cuenta destino y, si difieren, dejar la importación en "falló la lectura" con `IMPORT_PDF_ACCOUNT_MISMATCH`, sin filas; si la cuenta no tiene esos dígitos registrados, DEBE (MUST) procesarla con la advertencia `IMPORT_PDF_ACCOUNT_UNVERIFIED`. Si la moneda del extracto no es la de la cuenta, todas las filas DEBEN (MUST) quedar inválidas con `IMPORT_CURRENCY_MISMATCH`. Los demás datos del encabezado —titular, dirección, operador, sucursal— y el número de cuenta completo NO DEBEN (MUST NOT) guardarse en la importación, en sus filas, en la auditoría, en los eventos ni en los logs.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el encabezado del extracto trae "CLIENTE: TITULAR FICTICIO UNO DEMO", "Procesado por 00000001" y la cuenta "0000000001"
Entonces ni el nombre del titular, ni el operador, ni el número de cuenta completo aparecen en la importación, sus filas, la auditoría, los eventos ni los logs
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Busca cada texto con una expresión con límites en el staging, el job, audit.audit_log, la outbox y los logs capturados.
