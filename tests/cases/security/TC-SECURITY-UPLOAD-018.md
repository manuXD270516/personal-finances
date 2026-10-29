---
id: TC-SECURITY-UPLOAD-018
title: "La cuota y el máximo de subidas pendientes se aplican también con solicitudes concurrentes"
spec: security/file-upload-security
related_specs: []
requirement: "Cuota de almacenamiento por workspace"
scenario: null
requirement_status: provisional
fr: []
nfr:
  - "NFR-SEC-011"
  - "NFR-SEC-012"
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "quota"
  - "concurrency"
error_code: DOCUMENT_QUOTA_EXCEEDED
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Cuota 5368709120 bytes"
input:
  casos:
    - "used 5368000000 + solicitud de 1000000"
    - "quedan 1500000 libres y llegan 2 solicitudes de 1000000 en conexiones distintas"
    - "20 pendientes + solicitud 21"
    - "GET W/documents/usage"
steps:
  - "Preparar los contadores"
  - "Ejecutar las solicitudes (las concurrentes en clientes pg distintos)"
  - "Consultar el uso"
expected_result:
  - "422 DOCUMENT_QUOTA_EXCEEDED"
  - "Exactamente una de las concurrentes se registra"
  - "409 DOCUMENT_PENDING_UPLOADS_EXCEEDED"
  - "usage refleja usedBytes, reservedBytes, quotaBytes y pendingUploads"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-018 — La cuota y el máximo de subidas pendientes se aplican también con solicitudes concurrentes

## Intención

Bloqueo de fila sobre storage_usage (design.md decisión 11).

## Escenario

```gherkin
Dado que a "W1" le quedan 1500000 bytes libres
Cuando llegan a la vez dos solicitudes de 1000000 bytes
Entonces exactamente una se registra y la otra se rechaza con "DOCUMENT_QUOTA_EXCEEDED"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Cuota de almacenamiento por workspace" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
