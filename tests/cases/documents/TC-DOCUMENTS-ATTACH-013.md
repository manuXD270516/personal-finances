---
id: TC-DOCUMENTS-ATTACH-013
title: "Un VIEWER lista los adjuntos de un gasto y los documentos filtrados del workspace"
spec: documents/attachments
related_specs: []
requirement: "Consulta de documentos y adjuntos"
scenario: "Adjuntos de un gasto vistos por un VIEWER"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-003"
  - "FR-DOCUMENTS-004"
nfr:
  - "NFR-SEC-003"
invariants: []
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
  - "query"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Estado final de TC-DOCUMENTS-ATTACH-008"
  - "W2 con 2 documentos"
input:
  usuario: "viewer"
  requests:
    - "GET …/documents?targetType=TRANSACTION&targetId={gasto150}"
    - "GET …/documents?purpose=RECEIPT&status=AVAILABLE"
    - "GET …/documents?archived=true"
steps:
  - "Ejecutar las consultas"
  - "Buscar ids de W2 en las respuestas"
expected_result:
  - "Adjuntos del gasto: ticket y garantía con originalName, detectedContentType, sizeBytes, availableAt y status"
  - "Los filtros respetan propósito, estado y archivado; paginación por cursor"
  - "Ningún documento de W2"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-013 — Un VIEWER lista los adjuntos de un gasto y los documentos filtrados del workspace

## Intención

Lectura para todo miembro (docs/10 §roles).

## Escenario

```gherkin
Dado el gasto de 150.00 BOB con 2 adjuntos
Cuando un VIEWER consulta sus adjuntos
Entonces recibe "ticket-supermercado.jpg" y "garantia.pdf" con tipo, tamaño, fecha y estado
```

## Notas

- Change: `add-document-attachments`. Requirement: "Consulta de documentos y adjuntos" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
