---
id: TC-DOCUMENTS-ATTACH-011
title: "Un elemento no supera los 20 documentos adjuntos"
spec: documents/attachments
related_specs: []
requirement: "Límite de adjuntos por elemento"
scenario: "Vínculo número 21"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-003"
nfr:
  - "NFR-SEC-011"
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests: ["packages/contexts/documents/src/application/documents.service.test.ts", "packages/contexts/documents/src/domain/document.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "limits"
error_code: ATTACHMENT_LIMIT_EXCEEDED
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Gasto con 20 adjuntos y un documento AVAILABLE más"
input:
  usuario: "editor"
  request: "POST …/documents/{doc21}/links"
steps:
  - "Intentar el vínculo 21"
  - "Contar los adjuntos del gasto"
expected_result:
  - "409 ATTACHMENT_LIMIT_EXCEEDED"
  - "El gasto sigue con 20"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-011 — Un elemento no supera los 20 documentos adjuntos

## Intención

Límite de abuso por destino (design.md decisión 9).

## Escenario

```gherkin
Dado un gasto con 20 adjuntos
Cuando el EDITOR adjunta otro
Entonces la respuesta es 409 con "ATTACHMENT_LIMIT_EXCEEDED"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Límite de adjuntos por elemento" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
