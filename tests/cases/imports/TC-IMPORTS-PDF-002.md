---
id: TC-IMPORTS-PDF-002
title: "Un documento PNG se rechaza con IMPORT_UNSUPPORTED_FORMAT al crear la importación"
spec: imports/import-pipeline
related_specs: []
requirement: "Formatos de archivo detectados por contenido"
scenario: "Documento de imagen"
requirement_status: provisional
fr: ["FR-IMPORTS-004", "FR-IMPORTS-016"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - packages/contexts/imports/src/testing/import-pdf.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: IMPORT_UNSUPPORTED_FORMAT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Documento de imagen\" del delta de add-pdf-statement-parser"
steps:
  - "un EDITOR crea una importación con un documento disponible detectado como PNG"
expected_result:
  - "se rechaza con `IMPORT_UNSUPPORTED_FORMAT` y no se crea ninguna importación"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-002 — Un documento PNG se rechaza con IMPORT_UNSUPPORTED_FORMAT al crear la importación

## Intención

El sistema DEBE (MUST) importar archivos CSV, OFX (1.x y 2.x), QIF, JSON del esquema propio y extractos PDF con texto, eligiendo el lector por el formato detectado en el contenido del documento y no por su nombre; un documento de un formato no importable DEBE (MUST) rechazarse al crear la importación con `IMPORT_UNSUPPORTED_FORMAT`. Un PDF DEBE (MUST) aceptarse al crear la importación y su lectura DEBE (MUST) decidirse en el worker: si no tiene texto o no corresponde a un diseño de extracto conocido, la importación DEBE (MUST) fallar en la etapa de lectura con el código correspondiente.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando un EDITOR crea una importación con un documento disponible detectado como PNG
Entonces se rechaza con `IMPORT_UNSUPPORTED_FORMAT` y no se crea ninguna importación
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
