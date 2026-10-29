---
id: TC-SECURITY-UPLOAD-012
title: "Una bomba de compresión XLSX se rechaza sin descomprimirla por completo"
spec: security/file-upload-security
related_specs: []
requirement: "Hojas de cálculo sin macros ni bombas de compresión"
scenario: "Bomba de compresión"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-002"
  - "FR-IMPORTS-017"
nfr:
  - "NFR-SEC-012"
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
  - "xlsx"
  - "zip-bomb"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Timeout explícito del test (CI lento)"
input:
  casos:
    - "XLSX de 40 KiB con una hoja que se infla a 2 GiB"
    - "XLSX con 1001 entradas"
    - "XLSX cuyo directorio central declara tamaños falsos"
    - "XLSX con entrada \"../evil\""
steps:
  - "Subir y confirmar cada caso midiendo memoria y tiempo de la verificación"
expected_result:
  - "Todos REJECTED/ARCHIVE_LIMITS_EXCEEDED (o TYPE_MISMATCH para la ruta inválida)"
  - "La verificación termina en menos de DOCUMENT_INSPECTION_TIMEOUT sin superar el límite de memoria del worker_thread"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-012 — Una bomba de compresión XLSX se rechaza sin descomprimirla por completo

## Intención

Caso 17 de la suite.

## Escenario

```gherkin
Cuando se sube un XLSX de 40 KiB cuya hoja se descomprime a 2 GiB
Entonces el documento queda "rechazado" con el motivo límites de archivo comprimido excedidos
```

## Notas

- Change: `add-document-attachments`. Requirement: "Hojas de cálculo sin macros ni bombas de compresión" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
