---
id: TC-DOCUMENTS-ATTACH-010
title: "Adjuntar un comprobante a un gasto de un mes cerrado no toca el periodo ni el ledger"
spec: documents/attachments
related_specs: []
requirement: "Adjuntos en periodos cerrados"
scenario: "Comprobante tardío de un mes cerrado"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-003"
nfr: []
invariants:
  - "INV-015"
priority: high
type: integration
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "attachments"
  - "closed-period"
  - "D65"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "\"2026-09\" cerrado con un gasto de 2800.00 BOB del 2026-09-05"
  - "Documento \"recibo-alquiler.pdf\" AVAILABLE"
input:
  usuario: "editor"
  request: "POST …/documents/{recibo}/links"
  body:
    targetType: "TRANSACTION"
    targetId: "{gasto2800}"
steps:
  - "Crear el vínculo"
  - "Desvincularlo"
  - "Comparar asientos y estado del periodo antes y después"
expected_result:
  - "201 y luego 204"
  - "\"2026-09\" sigue cerrado"
  - "Ningún asiento ni posting nuevo o modificado"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-010 — Adjuntar un comprobante a un gasto de un mes cerrado no toca el periodo ni el ledger

## Intención

D65 permite adjuntos en periodos cerrados.

## Escenario

```gherkin
Dado que "2026-09" está cerrado
Cuando el EDITOR adjunta "recibo-alquiler.pdf" al gasto de 2800.00 BOB del 2026-09-05
Entonces el vínculo se crea
  Y el periodo y sus asientos no cambian
```

## Notas

- Change: `add-document-attachments`. Requirement: "Adjuntos en periodos cerrados" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
