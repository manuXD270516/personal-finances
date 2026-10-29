---
id: TC-DOCUMENTS-ATTACH-006
title: "Una subida abandonada expira y libera la cuota reservada"
spec: documents/attachments
related_specs: []
requirement: "Expiración de subidas no completadas"
scenario: "Subida abandonada"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-001"
nfr:
  - "NFR-COMP-005"
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "retention"
  - "quota"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documento de 2000000 bytes pendiente desde 2026-10-29T10:00 con URL vencida a las 10:05"
  - "Reloj fijo 2026-10-29T11:10:00-04:00"
input:
  job: "ExpirePendingUploads"
steps:
  - "Ejecutar el mantenimiento"
  - "Consultar el documento y el uso del workspace"
expected_result:
  - "status REJECTED con rejectionReason UPLOAD_NOT_COMPLETED y actor SYSTEM en la auditoría"
  - "reservedBytes de W1 baja en 2000000 y pendingUploads en 1"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-006 — Una subida abandonada expira y libera la cuota reservada

## Intención

Las reservas no quedan colgadas (plazo de la URL + 1 h de gracia).

## Escenario

```gherkin
Dado un documento de 2000000 bytes pendiente desde las 10:00 con URL vencida a las 10:05
Cuando el mantenimiento corre a las 11:10
Entonces el documento queda "rechazado" por subida no completada
  Y la cuota reservada baja en 2000000 bytes
```

## Notas

- Change: `add-document-attachments`. Requirement: "Expiración de subidas no completadas" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
