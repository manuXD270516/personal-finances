---
id: TC-DOCUMENTS-ATTACH-016
title: "Un documento archivado sale del listado por defecto y sigue descargable"
spec: documents/attachments
related_specs: []
requirement: "Archivar documentos"
scenario: "Archivar un contrato"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-007"
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "archive"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "\"contrato-alquiler-2025.pdf\" AVAILABLE y vinculado a una cuenta"
input:
  usuario: "editor"
  requests:
    - "POST …/documents/{id}/archive (If-Match)"
    - "GET …/documents"
    - "GET …/documents?archived=true"
    - "GET …/documents/{id}/download"
    - "POST …/documents/{id}/unarchive"
steps:
  - "Archivar, listar, descargar y desarchivar"
expected_result:
  - "El listado por defecto lo excluye y el de archivados lo incluye"
  - "La descarga responde 200 y el vínculo se conserva"
  - "Desarchivar lo devuelve al listado por defecto"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-016 — Un documento archivado sale del listado por defecto y sigue descargable

## Intención

Archivar es la forma explícita de conservar (pregunta 6).

## Escenario

```gherkin
Dado "contrato-alquiler-2025.pdf" disponible
Cuando el EDITOR lo archiva
Entonces el listado por defecto ya no lo muestra y el de archivados sí
  Y sigue descargable
```

## Notas

- Change: `add-document-attachments`. Requirement: "Archivar documentos" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
