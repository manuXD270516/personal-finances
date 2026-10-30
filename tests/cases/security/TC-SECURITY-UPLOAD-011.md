---
id: TC-SECURITY-UPLOAD-011
title: "Un XLSX con proyecto de macros se rechaza"
spec: security/file-upload-security
related_specs: []
requirement: "Hojas de cálculo sin macros ni bombas de compresión"
scenario: "Libro con macros renombrado"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-002"
  - "FR-IMPORTS-017"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: security
level: container-integration
automation_status: automated
automated_tests: ["packages/contexts/documents/src/infrastructure/inspection/inspectors.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "upload"
  - "xlsx"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  casos:
    - "movimientos.xlsx con xl/vbaProject.bin"
    - "movimientos.xlsx con [Content_Types] macroEnabled"
    - "XLSX válido (control)"
steps:
  - "Subir y confirmar cada caso"
expected_result:
  - "Los dos primeros ⇒ REJECTED/MACROS_PRESENT"
  - "El control ⇒ AVAILABLE"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-011 — Un XLSX con proyecto de macros se rechaza

## Intención

Caso 16 de la suite.

## Escenario

```gherkin
Cuando se sube "movimientos.xlsx" que contiene un proyecto de macros
Entonces el documento queda "rechazado" con el motivo macros presentes
```

## Notas

- Change: `add-document-attachments`. Requirement: "Hojas de cálculo sin macros ni bombas de compresión" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
