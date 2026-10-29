---
id: TC-IMPORTS-PDF-043
title: "Una anotación de estado declarada variable no cambia la huella de la fila"
spec: imports/import-pipeline
related_specs: []
requirement: "Huella de las filas de un extracto PDF"
scenario: "Anotación variable en la glosa"
requirement_status: provisional
fr: ["FR-IMPORTS-010", "FR-IMPORTS-007", "FR-IMPORTS-016"]
nfr: []
invariants: ["INV-014"]
priority: high
type: domain
level: domain
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
input: "Datos del scenario \"Anotación variable en la glosa\" del delta de add-pdf-statement-parser"
steps:
  - "una transferencia recibida se importó con la glosa \"Transferencia de 0000000002. PERSONA FICTICIA BETA Aún falta 350\" y la nueva descarga trae la misma transferencia con \"Transferencia de 0000000002. PERSONA FICTICIA BETA Completado\""
expected_result:
  - "la fila se clasifica como ya importada"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-043 — Una anotación de estado declarada variable no cambia la huella de la fila

## Intención

Las filas de un extracto PDF DEBEN (MUST) identificarse con la huella de fila vigente, de modo que volver a descargar el mismo periodo, aunque el archivo tenga otros bytes por su fecha de consulta, clasifique como ya importadas las filas que ya tienen transacción; los fragmentos de glosa que el diseño declara como variables —anotaciones de estado que el banco recalcula al generar el PDF— NO DEBEN (MUST NOT) formar parte de la descripción usada en la huella, aunque la transacción conserve la glosa completa.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando una transferencia recibida se importó con la glosa "Transferencia de 0000000002. PERSONA FICTICIA BETA Aún falta 350" y la nueva descarga trae la misma transferencia con "Transferencia de 0000000002. PERSONA FICTICIA BETA Completado"
Entonces la fila se clasifica como ya importada
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
