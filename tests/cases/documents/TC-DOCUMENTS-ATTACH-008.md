---
id: TC-DOCUMENTS-ATTACH-008
title: "Adjuntar en relación N:M: un comprobante a dos gastos y dos documentos a un gasto"
spec: documents/attachments
related_specs: []
requirement: "Adjuntar documentos a elementos del workspace"
scenario: null
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-003"
nfr: []
invariants:
  - "INV-027"
priority: critical
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
  - "Gastos de 150.00 BOB y 35.50 BOB en W1"
  - "Documentos AVAILABLE \"ticket-supermercado.jpg\" y \"garantia.pdf\""
input:
  usuario: "editor"
  requests:
    - "POST …/documents/{ticket}/links {TRANSACTION, gasto150}"
    - "POST …/documents/{ticket}/links {TRANSACTION, gasto35}"
    - "POST …/documents/{garantia}/links {TRANSACTION, gasto150}"
    - "POST …/documents/{garantia}/links {TRANSACTION, gasto150} (repetido)"
steps:
  - "Crear los cuatro vínculos"
  - "Listar adjuntos de cada gasto y vínculos de cada documento"
expected_result:
  - "Tres 201 y un 200 con el vínculo existente"
  - "gasto 150.00 BOB: 2 adjuntos; gasto 35.50 BOB: 1"
  - "\"ticket-supermercado.jpg\" tiene 2 vínculos"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-008 — Adjuntar en relación N:M: un comprobante a dos gastos y dos documentos a un gasto

## Intención

La relación es muchos a muchos e idempotente (docs/08 §5.11).

## Escenario

```gherkin
Dado los gastos de 150.00 BOB y 35.50 BOB
Cuando el EDITOR adjunta el ticket a ambos y la garantía al de 150.00 BOB dos veces
Entonces el gasto de 150.00 BOB tiene 2 adjuntos y el de 35.50 BOB tiene 1
  Y el segundo vínculo de la garantía devuelve el existente
```

## Notas

- Change: `add-document-attachments`. Requirement: "Adjuntar documentos a elementos del workspace" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
