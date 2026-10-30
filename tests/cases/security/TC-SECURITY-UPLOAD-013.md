---
id: TC-SECURITY-UPLOAD-013
title: "La cuarentena queda vacía tras verificar y el barrido borra objetos de más de 24 horas"
spec: security/file-upload-security
related_specs: []
requirement: "Cuarentena hasta la verificación"
scenario: null
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: high
type: security
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "packages/contexts/documents/src/application/uploads.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "upload"
  - "quarantine"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Bucket de cuarentena sin versioning"
  - "Objeto huérfano en cuarentena con fecha de hace 25 horas"
input:
  casos:
    - "documento aceptado"
    - "documento rechazado"
    - "job SweepQuarantine"
steps:
  - "Verificar un archivo aceptado y uno rechazado"
  - "Listar la cuarentena y sus versiones"
  - "Ejecutar el barrido"
  - "Comprobar que el contrato de lectura de IMPORTS no puede leer la cuarentena"
expected_result:
  - "Sin objetos ni versiones en cuarentena tras cada verificación"
  - "El objeto de 25 h se borra"
  - "El bucket de cuarentena no tiene versioning y no se replica a B2"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-013 — La cuarentena queda vacía tras verificar y el barrido borra objetos de más de 24 horas

## Intención

La cuarentena no retiene texto plano.

## Escenario

```gherkin
Dado un documento rechazado por tipo distinto
Cuando termina la verificación
Entonces la cuarentena ya no contiene su objeto y la zona de documentos tampoco
```

## Notas

- Change: `add-document-attachments`. Requirement: "Cuarentena hasta la verificación" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
