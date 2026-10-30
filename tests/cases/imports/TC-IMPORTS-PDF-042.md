---
id: TC-IMPORTS-PDF-042
title: "Volver a descargar el mismo mes crea 0 transacciones aunque cambien los bytes del PDF"
spec: imports/import-pipeline
related_specs: []
requirement: "Huella de las filas de un extracto PDF"
scenario: "Mismo mes descargado otra vez"
requirement_status: provisional
fr: ["FR-IMPORTS-010", "FR-IMPORTS-007", "FR-IMPORTS-016"]
nfr: []
invariants: ["INV-014"]
priority: critical
type: integration
level: import
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - packages/contexts/imports/src/testing/import-pdf.test.ts
status: automated
regression_suite: true
phase: 6
tags: ["imports", "pdf"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Mismo mes descargado otra vez\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto de marzo de \"Banco Pampa Demo\" ya se importó con 11 transacciones y el usuario sube el mismo mes descargado otro día, con otra fecha de consulta"
expected_result:
  - "la vista previa informa 11 filas ya importadas y 0 nuevas"
  - "al aprobar se crean 0 transacciones"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-042 — Volver a descargar el mismo mes crea 0 transacciones aunque cambien los bytes del PDF

## Intención

Las filas de un extracto PDF DEBEN (MUST) identificarse con la huella de fila vigente, de modo que volver a descargar el mismo periodo, aunque el archivo tenga otros bytes por su fecha de consulta, clasifique como ya importadas las filas que ya tienen transacción; los fragmentos de glosa que el diseño declara como variables —anotaciones de estado que el banco recalcula al generar el PDF— NO DEBEN (MUST NOT) formar parte de la descripción usada en la huella, aunque la transacción conserve la glosa completa.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando el extracto de marzo de "Banco Pampa Demo" ya se importó con 11 transacciones y el usuario sube el mismo mes descargado otro día, con otra fecha de consulta
Entonces la vista previa informa 11 filas ya importadas y 0 nuevas
  Y al aprobar se crean 0 transacciones
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Criterio de salida de Phase 6: el segundo PDF difiere solo en la fecha de consulta del encabezado (otra suma SHA-256).
