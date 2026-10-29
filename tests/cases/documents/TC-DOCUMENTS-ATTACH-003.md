---
id: TC-DOCUMENTS-ATTACH-003
title: "Confirmar la subida de un PDF válido lo deja disponible y vacía la cuarentena"
spec: documents/attachments
related_specs: []
requirement: "Confirmar la subida y verificar el archivo"
scenario: "Confirmación de un PDF válido"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-001"
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: integration
level: container-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "verification"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documento de TC-DOCUMENTS-ATTACH-001 pendiente de subida"
  - "Fixture sintético tests/fixtures/documents/factura-luz-octubre.pdf (482133 bytes, sin JavaScript)"
input:
  pasos:
    - "PUT del fixture a la URL firmada"
    - "POST /api/v1/workspaces/{W1}/documents/{id}/complete"
steps:
  - "Subir el archivo a la URL"
  - "Confirmar la subida"
  - "Listar el bucket de cuarentena y el de documentos"
expected_result:
  - "200 con status AVAILABLE, detectedContentType application/pdf, sizeBytes 482133 y la suma declarada"
  - "La cuarentena no tiene el objeto; el bucket de documentos tiene ws/{W1}/documents/{id}"
  - "Se publica documents.AttachmentUploaded.v1"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-003 — Confirmar la subida de un PDF válido lo deja disponible y vacía la cuarentena

## Intención

La verificación síncrona de la confirmación (design.md decisión 3) promueve el archivo y limpia la cuarentena.

## Escenario

```gherkin
Dado el documento "factura-luz-octubre.pdf" pendiente de subida
Cuando el EDITOR sube los 482133 bytes y confirma
Entonces el documento queda "disponible" con tipo detectado "application/pdf"
  Y la cuarentena ya no contiene el archivo
```

## Notas

- Change: `add-document-attachments`. Requirement: "Confirmar la subida y verificar el archivo" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
