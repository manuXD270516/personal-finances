---
id: TC-SECURITY-UPLOAD-005
title: "Una URL de subida vencida se rechaza en el almacenamiento"
spec: security/file-upload-security
related_specs: []
requirement: "Integridad de la subida"
scenario: "Dirección vencida"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: high
type: security
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/upload-security.api.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "upload"
  - "presigned"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "DOCUMENT_UPLOAD_URL_TTL=PT5M; URL emitida y reloj del firmante adelantado 6 minutos (o TTL de prueba de 1 s)"
input:
  paso: "PUT del archivo con la URL vencida"
steps:
  - "Enviar el PUT"
  - "Consultar el documento"
expected_result:
  - "El almacenamiento responde 403"
  - "El documento sigue PENDING_UPLOAD"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-005 — Una URL de subida vencida se rechaza en el almacenamiento

## Intención

Caso 6 de la suite.

## Escenario

```gherkin
Dado una URL de subida con vencimiento de 5 minutos
Cuando se usa 6 minutos después
Entonces el almacenamiento rechaza la subida
  Y el documento sigue pendiente
```

## Notas

- Change: `add-document-attachments`. Requirement: "Integridad de la subida" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
