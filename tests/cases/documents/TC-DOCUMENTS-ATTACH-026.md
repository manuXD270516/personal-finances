---
id: TC-DOCUMENTS-ATTACH-026
title: "El recorrido de un documento muestra transiciones y vínculos como anotaciones"
spec: audit/lifecycle-timeline
related_specs: []
requirement: "Recorrido de un documento"
scenario: "Recorrido de un comprobante adjuntado y eliminado"
requirement_status: provisional
fr:
  - "FR-AUDIT-009"
  - "FR-AUDIT-010"
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "lifecycle"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  secuencia:
    - "editor sube y confirma \"ticket-supermercado.jpg\""
    - "editor lo adjunta al gasto de 150.00 BOB"
    - "owner lo elimina"
  request: "GET W/documents/{id}/lifecycle"
steps:
  - "Ejecutar la secuencia"
  - "Consultar el recorrido como VIEWER"
expected_result:
  - "Transiciones REQUEST_UPLOAD, COMPLETE, ACCEPT y DELETE en orden con actor e instante"
  - "Anotación de vínculo con el gasto"
  - "Estado actual DELETED"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-026 — El recorrido de un documento muestra transiciones y vínculos como anotaciones

## Intención

D37: todo agregado con ciclo de vida declara su máquina.

## Escenario

```gherkin
Dado un comprobante subido, adjuntado y eliminado
Cuando un miembro consulta su recorrido
Entonces ve las transiciones solicitar subida, confirmar, aceptar y eliminar
  Y la vinculación con el gasto como anotación
```

## Notas

- Change: `add-document-attachments`. Requirement: "Recorrido de un documento" (`audit/lifecycle-timeline`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
