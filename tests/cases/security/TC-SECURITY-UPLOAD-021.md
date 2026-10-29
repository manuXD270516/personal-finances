---
id: TC-SECURITY-UPLOAD-021
title: "La undécima solicitud de subida en un minuto se rechaza y el replay no consume cuota"
spec: security/file-upload-security
related_specs: []
requirement: "Límite de frecuencia de subidas"
scenario: "Undécima solicitud en un minuto"
requirement_status: provisional
fr: []
nfr:
  - "NFR-SEC-011"
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "rate-limit"
  - "costly"
error_code: RATE_LIMITED
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  usuario: "editor"
  casos:
    - "11 solicitudes con claves distintas en el mismo minuto"
    - "replay de la primera con su Idempotency-Key"
steps:
  - "Enviar las solicitudes"
expected_result:
  - "La undécima ⇒ 429 RATE_LIMITED sin registrar documento"
  - "El replay devuelve la respuesta original sin consumir cuota"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-021 — La undécima solicitud de subida en un minuto se rechaza y el replay no consume cuota

## Intención

Cuota costly (D113) aplicada a documentos.

## Escenario

```gherkin
Cuando un EDITOR hace 11 solicitudes de subida distintas en el mismo minuto
Entonces la undécima se rechaza con "RATE_LIMITED" y no registra ningún documento
```

## Notas

- Change: `add-document-attachments`. Requirement: "Límite de frecuencia de subidas" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
