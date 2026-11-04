---
id: TC-IMPORTS-PDF-044
title: "La verificación de la entrega falla si el repositorio contiene un archivo PDF"
spec: imports/import-pipeline
related_specs: []
requirement: "Extractos PDF de prueba generados por código"
scenario: "PDF versionado"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-SEC-015"]
nfr: ["NFR-SEC-015"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/pdf/pdf-layouts.test.ts
status: automated
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
input: "Datos del scenario \"PDF versionado\" del delta de add-pdf-statement-parser"
steps:
  - "un cambio agrega un archivo con extensión .pdf al repositorio"
expected_result:
  - "la verificación de la entrega falla y nombra el archivo"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-044 — La verificación de la entrega falla si el repositorio contiene un archivo PDF

## Intención

Las pruebas del lector de PDF DEBEN (MUST) usar extractos generados por código a partir de datos sintéticos marcados como tales y NO DEBEN (MUST NOT) usar extractos reales; el repositorio NO DEBE (MUST NOT) contener archivos PDF, y la verificación de la entrega DEBE (MUST) fallar si se versiona uno. Para cada diseño soportado, el extracto generado desde sus movimientos sintéticos DEBE (MUST) leerse exactamente igual a esos movimientos.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando un cambio agrega un archivo con extensión .pdf al repositorio
Entonces la verificación de la entrega falla y nombra el archivo
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Test de política sobre git ls-files; corre en el job unit.
