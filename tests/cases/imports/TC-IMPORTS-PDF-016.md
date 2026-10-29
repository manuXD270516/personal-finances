---
id: TC-IMPORTS-PDF-016
title: "Dibujar los fragmentos en orden aleatorio produce los mismos movimientos que el orden de lectura"
spec: imports/import-pipeline
related_specs: []
requirement: "Reconstrucción de la tabla del extracto por posición"
scenario: "Orden de dibujo distinto del orden visual"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-006"]
nfr: []
invariants: ["INV-001"]
priority: critical
type: integration
level: import
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
  - "Institución ficticia \"Banco Altiplano Demo\" con el diseño bo.bnb.cuenta versión 1"
input: "Datos del scenario \"Orden de dibujo distinto del orden visual\" del delta de add-pdf-statement-parser"
steps:
  - "el extracto PDF sintético de \"Banco Altiplano Demo\" dibuja sus fragmentos en orden aleatorio"
expected_result:
  - "la vista previa tiene los mismos 6 movimientos, con las mismas fechas, horas, montos y referencias, que cuando los dibuja en orden de lectura"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-016 — Dibujar los fragmentos en orden aleatorio produce los mismos movimientos que el orden de lectura

## Intención

El sistema DEBE (MUST) reconstruir las filas de movimientos a partir de la posición de cada fragmento de texto y no del orden en que el documento los dibuja: DEBE (MUST) agrupar los fragmentos por línea, asignarlos a la columna cuyo rango, derivado de los rótulos del encabezado de la tabla, los contiene, unir las líneas de continuación de una glosa a su movimiento con un espacio y conservar el orden impreso de las filas aunque no sea cronológico. Un fragmento que cae entre dos columnas NO DEBE (MUST NOT) asignarse por aproximación: su fila DEBE (MUST) quedar inválida con `IMPORT_PDF_AMBIGUOUS_CELL` y su número de línea.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
  Y Institución ficticia "Banco Altiplano Demo" con el diseño bo.bnb.cuenta versión 1
Cuando el extracto PDF sintético de "Banco Altiplano Demo" dibuja sus fragmentos en orden aleatorio
Entonces la vista previa tiene los mismos 6 movimientos, con las mismas fechas, horas, montos y referencias, que cuando los dibuja en orden de lectura
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- Imita el desorden de wkhtmltopdf de la ficha BNB; semilla fija para el orden aleatorio.
