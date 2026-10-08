---
id: TC-IDENTITY-RESTORE-004
title: "La importación rechaza archivos alterados o de una versión no soportada"
spec: identity/workspace-portability
related_specs: []
requirement: "Rechazo de archivos de export inválidos"
scenario: "Archivo modificado a mano"
requirement_status: confirmed
fr: [FR-IDENTITY-017]
nfr: [NFR-PORT-009]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["restore", "validation"]
error_code: "EXPORT_FILE_CORRUPTED"
preconditions:
  - "Export válido de \"W1\""
input:
  - "{\"tamper\":\"monto \\\"45.90\\\" → \\\"4.59\\\" en json/transactions.jsonl\"}"
  - "{\"manifest\":{\"formatVersion\":99}}"
  - "{\"manifest\":null}"
steps:
  - "Importar cada archivo"
expected_result:
  - "Alterado: 422 EXPORT_FILE_CORRUPTED (sha256 no coincide)"
  - "Versión 99: 422 EXPORT_FORMAT_UNSUPPORTED"
  - "Sin manifiesto: 422 EXPORT_FILE_CORRUPTED"
  - "Ningún workspace creado"
created: 2026-10-05
updated: 2026-10-08
---

# TC-IDENTITY-RESTORE-004 — La importación rechaza archivos alterados o de una versión no soportada

## Intención

La integridad del archivo se verifica antes de escribir nada.

## Escenario

```gherkin
Dado un export en el que se cambió "45.90" por "4.59"
Cuando el usuario lo importa
Entonces se rechaza con "EXPORT_FILE_CORRUPTED"
  Y no se crea ningún workspace
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
