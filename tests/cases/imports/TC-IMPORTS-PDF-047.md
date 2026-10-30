---
id: TC-IMPORTS-PDF-047
title: "El diagnóstico local informa la estructura del extracto sin montos, descripciones ni cuentas"
spec: imports/import-pipeline
related_specs: []
requirement: "Diagnóstico local de un extracto PDF sin revelar datos"
scenario: "Diagnóstico de un extracto"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-SEC-015"]
nfr: ["NFR-SEC-015"]
invariants: []
priority: low
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/pdf/pdf-probe.test.ts
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
input: "Datos del scenario \"Diagnóstico de un extracto\" del delta de add-pdf-statement-parser"
steps:
  - "el owner ejecuta el diagnóstico sobre el extracto PDF sintético de \"Banco Pampa Demo\""
expected_result:
  - "la salida informa el diseño `bo.ganadero.cuenta` versión 1, 2 páginas, 11 filas y la coherencia correcta"
  - "no contiene ningún monto, descripción, nombre ni número de cuenta del extracto"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-047 — El diagnóstico local informa la estructura del extracto sin montos, descripciones ni cuentas

## Intención

El repositorio PUEDE (MAY) ofrecer una herramienta local que lea un extracto PDF fuera del repositorio y muestre solo su estructura —diseño y versión detectados, páginas, filas reconocidas, resultado de la coherencia y números de línea no reconocidos—; esa salida NO DEBE (MUST NOT) incluir montos, saldos, descripciones, nombres ni números de cuenta.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el owner ejecuta el diagnóstico sobre el extracto PDF sintético de "Banco Pampa Demo"
Entonces la salida informa el diseño `bo.ganadero.cuenta` versión 1, 2 páginas, 11 filas y la coherencia correcta
  Y no contiene ningún monto, descripción, nombre ni número de cuenta del extracto
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
