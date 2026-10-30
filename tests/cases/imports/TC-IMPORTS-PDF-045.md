---
id: TC-IMPORTS-PDF-045
title: "Los PDF generados de los tres diseños se leen exactamente igual a sus movimientos sintéticos"
spec: imports/import-pipeline
related_specs: []
requirement: "Extractos PDF de prueba generados por código"
scenario: "Lectura igual a los movimientos sintéticos"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-SEC-015"]
nfr: ["NFR-SEC-015"]
invariants: ["INV-001", "INV-003"]
priority: critical
type: integration
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/infrastructure/pdf/pdf-statement-reader.pdf.test.ts
  - packages/contexts/imports/src/testing/pdf-statement-reader.test.ts
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
input: "Datos del scenario \"Lectura igual a los movimientos sintéticos\" del delta de add-pdf-statement-parser"
steps:
  - "se generan los extractos PDF de \"Banco Cumbre Demo\", \"Banco Pampa Demo\" y \"Banco Altiplano Demo\" desde sus movimientos sintéticos"
expected_result:
  - "la lectura de cada uno produce exactamente esos movimientos, con sus fechas, horas, descripciones, montos, saldos y el saldo del extracto"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PDF-045 — Los PDF generados de los tres diseños se leen exactamente igual a sus movimientos sintéticos

## Intención

Las pruebas del lector de PDF DEBEN (MUST) usar extractos generados por código a partir de datos sintéticos marcados como tales y NO DEBEN (MUST NOT) usar extractos reales; el repositorio NO DEBE (MUST NOT) contener archivos PDF, y la verificación de la entrega DEBE (MUST) fallar si se versiona uno. Para cada diseño soportado, el extracto generado desde sus movimientos sintéticos DEBE (MUST) leerse exactamente igual a esos movimientos.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando se generan los extractos PDF de "Banco Cumbre Demo", "Banco Pampa Demo" y "Banco Altiplano Demo" desde sus movimientos sintéticos
Entonces la lectura de cada uno produce exactamente esos movimientos, con sus fechas, horas, descripciones, montos, saldos y el saldo del extracto
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Oráculo: tests/fixtures/imports/statements-bo/<entidad>/expected.json (el mismo de TC-IMPORTS-STMT-001..005); comparación estructural exacta.
