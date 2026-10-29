---
id: TC-SECURITY-UPLOAD-010
title: "Texto con marcado activo, bytes nulos o JSON demasiado anidado se rechaza"
spec: security/file-upload-security
related_specs: []
requirement: "Formatos de texto sin marcado activo"
scenario: null
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: security
level: container-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "upload"
  - "text"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  casos:
    - "movimientos.csv que empieza con <html><script>"
    - "movimientos.csv con BOM y <svg onload>"
    - "movimientos.csv con bytes nulos"
    - "datos.json con 65 niveles"
    - "datos.json con 64 niveles (control)"
    - "extracto.ofx sin OFXHEADER ni <OFX>"
    - "CSV windows-1252 con acentos (control)"
steps:
  - "Subir y confirmar cada caso"
expected_result:
  - "HTML y SVG ⇒ REJECTED/ACTIVE_CONTENT"
  - "Bytes nulos y 65 niveles ⇒ REJECTED/MALFORMED_CONTENT"
  - "OFX sin cabecera ⇒ REJECTED/TYPE_MISMATCH"
  - "Los controles ⇒ AVAILABLE"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-010 — Texto con marcado activo, bytes nulos o JSON demasiado anidado se rechaza

## Intención

Casos 14 y 15 de la suite.

## Escenario

```gherkin
Cuando se sube "movimientos.csv" cuyo contenido empieza con "<html><script>"
Entonces el documento queda "rechazado" con el motivo contenido activo
```

## Notas

- Change: `add-document-attachments`. Requirement: "Formatos de texto sin marcado activo" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
