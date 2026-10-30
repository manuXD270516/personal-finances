---
id: TC-SECURITY-UPLOAD-015
title: "La descarga se entrega como adjunto con nosniff, sandbox, sin caché y nombre codificado"
spec: security/file-upload-security
related_specs: []
requirement: "Entrega segura de la descarga"
scenario: null
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-004"
nfr:
  - "NFR-SEC-008"
  - "NFR-SEC-012"
invariants: []
priority: critical
type: security
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "apps/web/test/integration/bff.int.test.ts", "packages/contexts/documents/src/application/documents.service.test.ts", "packages/contexts/documents/src/domain/file-policy.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "download"
  - "headers"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documentos \"foto-recibo.jpg\" y uno con nombre guardado 'a\";b.pdf'"
input:
  usuario: "viewer"
  request: "GET …/documents/{id}/download (API y BFF)"
steps:
  - "Descargar ambos por la API y por el BFF"
  - "Inspeccionar las cabeceras"
expected_result:
  - "Content-Disposition attachment con filename ASCII seguro y filename* RFC 5987"
  - "Content-Type image/jpeg y application/pdf canónicos"
  - "X-Content-Type-Options nosniff, Content-Security-Policy sandbox, Cache-Control private, no-store"
  - "Ninguna cabecera adicional inyectada"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-015 — La descarga se entrega como adjunto con nosniff, sandbox, sin caché y nombre codificado

## Intención

docs/12 §8.5 aplicado a la descarga por la API.

## Escenario

```gherkin
Cuando se descarga "foto-recibo.jpg"
Entonces la respuesta lo entrega como adjunto con tipo "image/jpeg", sin adivinar el tipo, en modo aislado y sin caché compartida
```

## Notas

- Change: `add-document-attachments`. Requirement: "Entrega segura de la descarga" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
