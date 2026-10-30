---
id: TC-DOCUMENTS-ATTACH-007
title: "El mismo contenido se deduplica dentro del workspace y nunca entre workspaces"
spec: documents/attachments
related_specs: []
requirement: "Deduplicación por contenido dentro del workspace"
scenario: null
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-006"
nfr:
  - "NFR-SEC-003"
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "packages/contexts/documents/src/application/uploads.service.test.ts", "packages/contexts/documents/test/integration/pg-documents.int.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "dedupe"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "W1 tiene \"extracto-oct.csv\" AVAILABLE con suma S"
input:
  - usuario: "editor"
    request: "POST /api/v1/workspaces/{W1}/documents/uploads"
    body:
      fileName: "copia-extracto.csv"
      sha256: "S"
  - usuario: "owner"
    request: "POST /api/v1/workspaces/{W2}/documents/uploads"
    body:
      fileName: "otro.csv"
      sha256: "S"
steps:
  - "Solicitar la subida en W1 con la suma S"
  - "Solicitar la subida en W2 con la suma S"
  - "Comparar el uso de cuota antes y después"
expected_result:
  - "W1: 200 con el documento existente, deduplicated true y upload null; usedBytes sin cambios"
  - "W2: 201 con un documento nuevo PENDING_UPLOAD; ninguna respuesta revela ids ni nombres de W1"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-007 — El mismo contenido se deduplica dentro del workspace y nunca entre workspaces

## Intención

FR-DOCUMENTS-006 sin abrir un canal de información entre workspaces.

## Escenario

```gherkin
Dado que "W1" ya tiene disponible "extracto-oct.csv"
Cuando un EDITOR de "W1" solicita subir otro archivo con la misma suma
Entonces recibe el documento existente sin URL ni consumo de cuota
Y cuando un miembro de "W2" pide lo mismo se registra un documento nuevo de "W2"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Deduplicación por contenido dentro del workspace" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
