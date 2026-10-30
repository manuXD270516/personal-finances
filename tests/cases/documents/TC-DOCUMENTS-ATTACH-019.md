---
id: TC-DOCUMENTS-ATTACH-019
title: "Cada operación de documentos y cada descarga quedan auditadas sin el nombre original"
spec: documents/attachments
related_specs: []
requirement: "Auditoría de documentos"
scenario: "Descarga auditada"
requirement_status: confirmed
fr:
  - "FR-AUDIT-001"
  - "FR-AUDIT-005"
nfr:
  - "NFR-SEC-015"
invariants:
  - "INV-029"
priority: critical
type: integration
level: api
automation_status: automated
automated_tests: ["packages/contexts/documents/src/application/uploads.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "audit"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  secuencia:
    - "solicitar subida"
    - "confirmar"
    - "vincular"
    - "desvincular"
    - "archivar"
    - "descargar (viewer)"
    - "eliminar"
steps:
  - "Ejecutar la secuencia con \"factura-luz-octubre.pdf\""
  - "Consultar la auditoría global filtrando por el documento"
  - "Forzar una falla de la escritura de auditoría en la descarga"
expected_result:
  - "Un registro por operación con actor e instante, en la misma transacción"
  - "El registro de la descarga tiene al VIEWER como actor"
  - "Ningún registro contiene \"factura-luz-octubre\""
  - "Con la auditoría fallida la descarga no entrega el archivo"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-019 — Cada operación de documentos y cada descarga quedan auditadas sin el nombre original

## Intención

docs/12 §13: las descargas de documentos se auditan como lectura.

## Escenario

```gherkin
Dado "factura-luz-octubre.pdf" disponible
Cuando un VIEWER lo descarga
Entonces existe un registro de auditoría de la descarga con el VIEWER como actor
  Y el registro no contiene "factura-luz-octubre"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Auditoría de documentos" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
