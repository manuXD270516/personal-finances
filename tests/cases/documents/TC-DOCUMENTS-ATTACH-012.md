---
id: TC-DOCUMENTS-ATTACH-012
title: "Desvincular conserva el documento y sus demás vínculos"
spec: documents/attachments
related_specs: []
requirement: "Desvincular un documento"
scenario: "Quitar un adjunto"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-003"
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "attachments"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Estado final de TC-DOCUMENTS-ATTACH-008"
input:
  usuario: "editor"
  request: "DELETE …/documents/{ticket}/links/{link35}"
steps:
  - "Quitar el vínculo"
  - "Consultar el gasto de 35.50 BOB y el documento"
expected_result:
  - "204"
  - "Gasto de 35.50 BOB sin adjuntos"
  - "Ticket AVAILABLE, con 1 vínculo al gasto de 150.00 BOB y last_unlinked_at actualizado"
  - "Registro de auditoría documents.attachment.unlinked"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-012 — Desvincular conserva el documento y sus demás vínculos

## Intención

Quitar un adjunto no borra el documento.

## Escenario

```gherkin
Dado el ticket adjunto a los gastos de 150.00 BOB y 35.50 BOB
Cuando el EDITOR lo quita del gasto de 35.50 BOB
Entonces ese gasto queda sin adjuntos
  Y el ticket sigue adjunto al gasto de 150.00 BOB
```

## Notas

- Change: `add-document-attachments`. Requirement: "Desvincular un documento" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
