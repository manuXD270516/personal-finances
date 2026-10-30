---
id: TC-DOCUMENTS-ATTACH-009
title: "Vincular con destino inexistente, ajeno o documento rechazado o eliminado se rechaza"
spec: documents/attachments
related_specs: []
requirement: "Validación del documento y del destino del vínculo"
scenario: null
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-003"
nfr:
  - "NFR-SEC-003"
invariants:
  - "INV-025"
priority: high
type: api
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "packages/contexts/documents/src/application/documents.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "attachments"
  - "isolation"
error_code: REFERENCE_NOT_FOUND
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Transacción \"W2-gasto\" de W2"
  - "Documentos de W1: uno AVAILABLE, uno PENDING_UPLOAD, uno REJECTED y uno DELETED"
  - "Un préstamo, una suscripción, una cuenta, un periodo y una importación de W1"
input:
  usuario: "editor"
  casos:
    - "destino W2-gasto"
    - "targetType FOO"
    - "documento PENDING_UPLOAD"
    - "documento REJECTED"
    - "documento DELETED"
    - "CONVERSION apuntando a un gasto"
    - "cada uno de los 7 tipos con destino válido"
steps:
  - "Intentar cada vínculo"
  - "Contar los vínculos creados"
expected_result:
  - "422 REFERENCE_NOT_FOUND para el destino de W2 y para CONVERSION sobre un gasto"
  - "400 VALIDATION_FAILED para el tipo no soportado"
  - "409 DOCUMENT_NOT_AVAILABLE, 409 DOCUMENT_REJECTED y 410 DOCUMENT_DELETED"
  - "Solo los 7 vínculos válidos existen"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-009 — Vincular con destino inexistente, ajeno o documento rechazado o eliminado se rechaza

## Intención

La existencia del destino la confirma el contrato del contexto dueño bajo RLS (design.md decisión 9).

## Escenario

```gherkin
Dado un documento de "W1" y una transacción de "W2"
Cuando el EDITOR de "W1" intenta adjuntarlo a la transacción de "W2"
Entonces la respuesta es 422 con "REFERENCE_NOT_FOUND"
  Y no se crea el vínculo
```

## Notas

- Change: `add-document-attachments`. Requirement: "Validación del documento y del destino del vínculo" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
