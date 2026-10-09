---
id: TC-IDENTITY-RESTORE-007
title: "La importación rechaza un archivo mayor que 200 MB sin crear nada"
spec: identity/workspace-portability
related_specs: []
requirement: "Rechazo de archivos de export inválidos"
scenario: "Archivo mayor que el límite"
requirement_status: confirmed
fr: [FR-IDENTITY-017]
nfr: [NFR-PORT-009]
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/workspace-import.api.test.ts","packages/contexts/identity/src/application/portability/workspace-import.service.test.ts"]
status: automated
regression_suite: false
phase: 2
tags: ["restore", "validation", "limits"]
error_code: "UPLOAD_TOO_LARGE"
preconditions:
  - "WORKSPACE_IMPORT_MAX_BYTES con su valor por defecto (200 MB)"
  - "\"U1\" autenticado hace 1 minuto"
input:
  fileSizeBytes: 220200960
steps:
  - "POST /workspace-imports con un archivo de 210 MB (220200960 bytes) e Idempotency-Key"
expected_result:
  - "413 UPLOAD_TOO_LARGE"
  - "No se crea ningún workspace ni registro de importación en curso; el archivo subido no queda almacenado"
created: 2026-10-08
updated: 2026-10-08
---

# TC-IDENTITY-RESTORE-007 — La importación rechaza un archivo mayor que 200 MB sin crear nada

## Intención

Decisión del owner docs/33 D100 (pregunta 42 de docs/32): el import es atómico en una sola transacción de BD y por eso se acota a 200 MB. Protege el límite que hace viable esa atomicidad.

## Escenario

```gherkin
Dado el límite de importación de 200 MB
Cuando el usuario importa un archivo de export de 210 MB
Entonces se rechaza con "UPLOAD_TOO_LARGE"
  Y no se crea ningún workspace
```

## Notas

- El archivo puede generarse con relleno sintético; no necesita ser un export válido porque el límite se evalúa antes de leer el manifiesto.
