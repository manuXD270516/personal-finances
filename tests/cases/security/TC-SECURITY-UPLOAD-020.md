---
id: TC-SECURITY-UPLOAD-020
title: "Documentos, vínculos y descargas de otro workspace son indistinguibles de inexistentes"
spec: security/file-upload-security
related_specs: []
requirement: "Aislamiento de documentos por workspace"
scenario: "Descarga de un documento ajeno"
requirement_status: provisional
fr: []
nfr:
  - "NFR-SEC-003"
  - "NFR-SEC-004"
invariants:
  - "INV-025"
priority: critical
type: security
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "isolation"
  - "rls"
  - "property-based"
error_code: RESOURCE_NOT_FOUND
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documento AVAILABLE de W2"
input:
  usuario: "owner (miembro de W1 y W2)"
  operaciones: "todas las de W/documents* con ids de W2 bajo W1; lecturas de las tablas documents.* sin contexto"
steps:
  - "Ejecutar cada operación"
  - "Comparar con un id inexistente"
  - "Leer las tablas sin contexto de workspace"
expected_result:
  - "Mismo estado y código que un id inexistente (404 RESOURCE_NOT_FOUND o 422 REFERENCE_NOT_FOUND)"
  - "Ninguna respuesta con datos de W2"
  - "Sin contexto ⇒ error PF002 (TC-SECURITY-RLS-007 incluye las tablas)"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-020 — Documentos, vínculos y descargas de otro workspace son indistinguibles de inexistentes

## Intención

Extiende TC-SECURITY-ISOLATION-001 a documentos.

## Escenario

```gherkin
Dado un documento de "W2"
Cuando el OWNER de "W1" y "W2" pide su descarga bajo "W1"
Entonces la respuesta es 404 con "RESOURCE_NOT_FOUND", igual que para un identificador inexistente
```

## Notas

- Change: `add-document-attachments`. Requirement: "Aislamiento de documentos por workspace" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
