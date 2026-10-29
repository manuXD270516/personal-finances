---
id: TC-SECURITY-UPLOAD-014
title: "Claves de objeto, logs, métricas y trazas no contienen el nombre ni datos del usuario"
spec: security/file-upload-security
related_specs: []
requirement: "Claves de objeto y registros sin datos personales"
scenario: null
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-005"
nfr:
  - "NFR-SEC-015"
invariants: []
priority: critical
type: security
level: container-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "upload"
  - "privacy"
  - "logs"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Captura de logs, métricas y spans del proceso"
input:
  casos:
    - "\"Extracto Juan Perez CI 1234567.pdf\""
    - "nombre \"..\\..\\windows\\factura\\n.pdf\""
    - "nombre de 300 caracteres"
steps:
  - "Subir, confirmar y descargar cada caso"
  - "Inspeccionar claves de objeto, logs, métricas y spans"
  - "Consultar el nombre guardado"
expected_result:
  - "Claves ws/{uuid}/{uuid} y ws/{uuid}/documents/{uuid}"
  - "Ningún log, métrica ni span contiene \"Juan\" ni \"1234567\""
  - "Nombre guardado \"factura.pdf\"; el de 300 caracteres recortado a 255 conservando la extensión"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-014 — Claves de objeto, logs, métricas y trazas no contienen el nombre ni datos del usuario

## Intención

FR-DOCUMENTS-005 y test canario de NFR-SEC-015.

## Escenario

```gherkin
Cuando se sube "Extracto Juan Perez CI 1234567.pdf"
Entonces la clave del objeto contiene solo identificadores opacos
  Y ningún registro técnico contiene "Juan" ni "1234567"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Claves de objeto y registros sin datos personales" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
