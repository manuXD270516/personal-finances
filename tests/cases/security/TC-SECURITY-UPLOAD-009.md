---
id: TC-SECURITY-UPLOAD-009
title: "Un PDF que exige contraseña para abrirse se rechaza como contenido cifrado"
spec: security/file-upload-security
related_specs: []
requirement: "PDF sin contenido activo"
scenario: "PDF con contraseña de apertura"
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
automated_tests: ["packages/contexts/documents/src/infrastructure/inspection/inspectors.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "upload"
  - "pdf"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  casos:
    - "PDF con contraseña de usuario"
    - "PDF con solo contraseña de propietario (permisos)"
steps:
  - "Subir y confirmar ambos"
expected_result:
  - "Con contraseña de usuario ⇒ REJECTED/ENCRYPTED_CONTENT"
  - "Solo de propietario ⇒ AVAILABLE (pregunta 7)"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-009 — Un PDF que exige contraseña para abrirse se rechaza como contenido cifrado

## Intención

Caso 13 de la suite.

## Escenario

```gherkin
Cuando se sube un extracto PDF que exige contraseña para abrirse
Entonces el documento queda "rechazado" con el motivo contenido cifrado
```

## Notas

- Change: `add-document-attachments`. Requirement: "PDF sin contenido activo" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
