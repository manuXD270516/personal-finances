---
id: TC-DOCUMENTS-ATTACH-005
title: "Repetir la confirmación de un documento disponible no lo verifica de nuevo"
spec: documents/attachments
related_specs: []
requirement: "Confirmar la subida y verificar el archivo"
scenario: "Confirmación repetida"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-001"
nfr: []
invariants:
  - "INV-027"
priority: medium
type: api
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "packages/contexts/documents/src/application/uploads.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "idempotency"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documento \"factura-luz-octubre.pdf\" ya AVAILABLE"
input:
  usuario: "editor"
  request: "POST /api/v1/workspaces/{W1}/documents/{id}/complete"
  nota: "con otra Idempotency-Key"
steps:
  - "Confirmar de nuevo"
  - "Contar los registros de auditoría documents.document.accepted del documento"
expected_result:
  - "200 con el mismo documento AVAILABLE y la misma versión"
  - "Sigue habiendo un único registro de aceptación"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-005 — Repetir la confirmación de un documento disponible no lo verifica de nuevo

## Intención

La confirmación es segura ante reintentos del navegador.

## Escenario

```gherkin
Dado un documento "disponible"
Cuando el EDITOR vuelve a confirmar su subida
Entonces recibe el mismo documento "disponible"
  Y no se registra una segunda verificación
```

## Notas

- Change: `add-document-attachments`. Requirement: "Confirmar la subida y verificar el archivo" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
