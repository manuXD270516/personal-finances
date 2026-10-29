---
id: TC-IMPORTS-PDF-005
title: "Superar el límite de memoria del hilo aislado falla la importación sin tumbar el worker"
spec: imports/import-pipeline
related_specs: []
requirement: "Extracción del texto de un PDF en un proceso aislado"
scenario: "Memoria del hilo aislado excedida"
requirement_status: provisional
fr: ["FR-IMPORTS-016", "FR-IMPORTS-002", "FR-SEC-012", "FR-SEC-013"]
nfr: ["NFR-SEC-012", "NFR-SEC-013"]
invariants: []
priority: high
type: security
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "pdf"]
error_code: IMPORT_PDF_EXTRACTION_FAILED
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, BOB, últimos dígitos registrados \"0001\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles"
input: "Datos del scenario \"Memoria del hilo aislado excedida\" del delta de add-pdf-statement-parser"
steps:
  - "la extracción de un PDF supera el límite de memoria del hilo aislado"
expected_result:
  - "la importación queda en \"falló la lectura\" con `IMPORT_PDF_EXTRACTION_FAILED` y el motivo de memoria, sin filas"
  - "el proceso del worker sigue activo"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PDF-005 — Superar el límite de memoria del hilo aislado falla la importación sin tumbar el worker

## Intención

El sistema DEBE (MUST) extraer el texto de un extracto PDF con la posición de cada fragmento en un hilo aislado del proceso del worker, con límites configurables de memoria, tiempo, páginas y fragmentos de texto, sin renderizar páginas, sin ejecutar código del documento y sin cargar recursos externos. Exceder un límite o no poder leer el documento DEBE (MUST) dejar la importación en "falló la lectura" con `IMPORT_PDF_EXTRACTION_FAILED` y el motivo, sin filas, y el worker DEBE (MUST) seguir procesando las importaciones siguientes. Un PDF con contraseña solo de propietario DEBE (MUST) leerse como cualquier otro. Los metadatos del documento (autor, creador, productor, título) NO DEBEN (MUST NOT) guardarse ni registrarse.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, BOB, últimos dígitos registrados "0001")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Extractos PDF generados por código desde movimientos sintéticos (marca SINTETICO), nunca versionados; documentos con propósito extracto para importar disponibles
Cuando la extracción de un PDF supera el límite de memoria del hilo aislado
Entonces la importación queda en "falló la lectura" con `IMPORT_PDF_EXTRACTION_FAILED` y el motivo de memoria, sin filas
  Y el proceso del worker sigue activo
```

## Notas

- Change: `add-pdf-statement-parser` (Phase 6, D324). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún extracto real del owner ni PDF versionado (D255, D281, D282).
- El test usa un hilo de prueba que reserva memoria hasta superar resourceLimits; ERR_WORKER_OUT_OF_MEMORY se traduce al motivo de memoria.
