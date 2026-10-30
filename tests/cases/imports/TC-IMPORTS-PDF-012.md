---
id: TC-IMPORTS-PDF-012
title: "El diseño se detecta por los rótulos fijos de la primera página y se registra con su versión"
spec: imports/import-pipeline
related_specs: []
requirement: "Diseños de extracto PDF por institución, versionados"
scenario: "Diseño detectado por los rótulos del encabezado"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-005"]
nfr: []
invariants: []
priority: high
type: integration
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/import-pdf.test.ts
  - packages/contexts/imports/src/testing/pdf-statement-reader.test.ts
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
  - "Institución ficticia \"Banco Pampa Demo\"; \"Banco BOB\" sin perfil PDF"
input: "Datos del scenario \"Diseño detectado por los rótulos del encabezado\" del delta de add-pdf-statement-parser"
steps:
  - "un EDITOR importa el extracto PDF sintético de \"Banco Pampa Demo\" y \"Banco BOB\" no tiene perfil PDF"
expected_result:
  - "la importación registra el diseño `bo.ganadero.cuenta` en su versión 1 y queda \"en revisión\""
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-012 — El diseño se detecta por los rótulos fijos de la primera página y se registra con su versión

## Intención

El sistema DEBE (MUST) leer los extractos PDF con diseños declarativos por institución, cada uno con identificador y versión, derivados de las fichas de formato registradas; una versión publicada de un diseño NO DEBE (MUST NOT) modificarse, y un cambio de formato del banco DEBE (MUST) publicarse como una versión nueva. Al leer, el sistema DEBE (MUST) usar la versión fijada en el perfil PDF de la cuenta o de su institución si existe y, si no, detectar el diseño por los rótulos fijos de la primera página, probando primero la versión más reciente; la importación DEBE (MUST) registrar el diseño y la versión aplicados. Un PDF con texto que no corresponde a ningún diseño DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_LAYOUT_UNKNOWN`, sin filas. La detección NO DEBE (MUST NOT) depender del nombre del banco ni de datos del titular.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
  Y Institución ficticia "Banco Pampa Demo"; "Banco BOB" sin perfil PDF
Cuando un EDITOR importa el extracto PDF sintético de "Banco Pampa Demo" y "Banco BOB" no tiene perfil PDF
Entonces la importación registra el diseño `bo.ganadero.cuenta` en su versión 1 y queda "en revisión"
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
