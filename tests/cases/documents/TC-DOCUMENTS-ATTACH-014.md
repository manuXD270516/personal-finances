---
id: TC-DOCUMENTS-ATTACH-014
title: "La descarga por la API devuelve el contenido original con su suma"
spec: documents/attachments
related_specs: []
requirement: "Descarga a través de la API"
scenario: "Descargar un comprobante"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-004"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: integration
level: container-integration
automation_status: automated
automated_tests: ["packages/contexts/documents/src/application/documents.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "download"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "\"factura-luz-octubre.pdf\" AVAILABLE (482133 bytes)"
input:
  usuario: "viewer"
  request: "GET /api/v1/workspaces/{W1}/documents/{id}/download"
steps:
  - "Descargar por la API (y por el BFF)"
  - "Calcular el SHA-256 del cuerpo"
  - "Buscar en la respuesta de getDocument cualquier URL al almacenamiento"
expected_result:
  - "200 con 482133 bytes y Repr-Digest igual a la suma informada al subir"
  - "Ninguna respuesta de la API contiene una URL GET al almacenamiento"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-014 — La descarga por la API devuelve el contenido original con su suma

## Intención

La descarga va solo por la API (design.md decisión 7, pregunta 1).

## Escenario

```gherkin
Dado "factura-luz-octubre.pdf" disponible
Cuando un VIEWER lo descarga
Entonces recibe los 482133 bytes originales con la suma informada al subirlo
```

## Notas

- Change: `add-document-attachments`. Requirement: "Descarga a través de la API" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
