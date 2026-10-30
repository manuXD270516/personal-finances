---
id: TC-DOCUMENTS-ATTACH-021
title: "Los eventos de disponible y rechazado se publican sin el nombre del archivo"
spec: documents/attachments
related_specs: []
requirement: "Eventos de disponibilidad de documentos"
scenario: "Evento de documento disponible"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-001"
nfr:
  - "NFR-SEC-015"
invariants: []
priority: medium
type: integration
level: event-contract
automation_status: automated
automated_tests: ["packages/contexts/documents/src/application/uploads.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "events"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  casos:
    - "\"extracto-oct.csv\" queda AVAILABLE"
    - "un PNG renombrado queda REJECTED"
steps:
  - "Leer las filas del outbox"
  - "Validar contra contracts/events/documents/*.v1.schema.json"
expected_result:
  - "Un documents.AttachmentUploaded.v1 con documentId, text/csv, 18874368, suma y propósito IMPORT_SOURCE"
  - "Un documents.DocumentRejected.v1 con reason TYPE_MISMATCH"
  - "Ningún payload contiene \"extracto-oct\""
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-021 — Los eventos de disponible y rechazado se publican sin el nombre del archivo

## Intención

docs/11: evento sin nombre de archivo.

## Escenario

```gherkin
Dado "extracto-oct.csv" recién verificado
Cuando queda disponible
Entonces se publica un único evento de documento disponible sin el texto "extracto-oct"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Eventos de disponibilidad de documentos" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
