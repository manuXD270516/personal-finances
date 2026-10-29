---
id: TC-SECURITY-UPLOAD-008
title: "PDF con JavaScript visible u ofuscado en flujos comprimidos se rechaza como contenido activo"
spec: security/file-upload-security
related_specs: []
requirement: "PDF sin contenido activo"
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
  - "pdf"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "PDFs sintéticos generados en el test"
input:
  casos:
    - "/OpenAction → /S /JavaScript /JS"
    - "/J#61vaScript dentro de un /ObjStm con /FlateDecode"
    - "/Launch"
    - "/EmbeddedFiles"
    - "/XFA"
    - "/RichMedia"
    - "PDF de texto válido con /OpenAction a una vista (control positivo)"
steps:
  - "Subir y confirmar cada PDF"
expected_result:
  - "Los 6 primeros ⇒ REJECTED/ACTIVE_CONTENT"
  - "El control positivo ⇒ AVAILABLE"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-008 — PDF con JavaScript visible u ofuscado en flujos comprimidos se rechaza como contenido activo

## Intención

Casos 11 y 12 de la suite; docs/12 §8.4 (rechazo en v1).

## Escenario

```gherkin
Cuando se sube un PDF cuyo diccionario "/J#61vaScript" está dentro de un flujo de objetos comprimido
Entonces el documento queda "rechazado" con el motivo contenido activo
```

## Notas

- Change: `add-document-attachments`. Requirement: "PDF sin contenido activo" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
