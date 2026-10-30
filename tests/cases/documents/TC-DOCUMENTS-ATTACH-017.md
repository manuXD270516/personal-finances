---
id: TC-DOCUMENTS-ATTACH-017
title: "Eliminar un comprobante destruye su clave, quita vínculos y libera cuota sin tocar el gasto"
spec: documents/attachments
related_specs: []
requirement: "Eliminar un documento"
scenario: "Eliminar un comprobante adjunto"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-007"
nfr:
  - "NFR-COMP-002"
  - "NFR-SEC-006"
invariants:
  - "INV-029"
priority: high
type: integration
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "packages/contexts/documents/src/application/documents.service.test.ts", "packages/contexts/documents/src/domain/document.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "delete"
  - "crypto-shredding"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "\"ticket-supermercado.jpg\" (1250000 bytes) AVAILABLE, adjunto al gasto de 150.00 BOB"
input:
  usuario: "owner"
  request: "DELETE /api/v1/workspaces/{W1}/documents/{ticket} (If-Match)"
steps:
  - "Eliminar"
  - "Consultar el documento, los adjuntos del gasto, el uso y la fila en la base"
  - "Listar las versiones del objeto en el bucket"
  - "Comparar el gasto y su asiento"
expected_result:
  - "204; status DELETED con metadatos conservados"
  - "wrapped_key y key_id nulos; el objeto y todas sus versiones borrados"
  - "El gasto ya no lista el adjunto y usedBytes baja en 1250000"
  - "Gasto y asiento sin cambios; auditoría documents.document.deleted"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-017 — Eliminar un comprobante destruye su clave, quita vínculos y libera cuota sin tocar el gasto

## Intención

El borrado es por destrucción de la clave más borrado de versiones (design.md decisión 6).

## Escenario

```gherkin
Dado el ticket de 1250000 bytes adjunto al gasto de 150.00 BOB
Cuando el OWNER lo elimina
Entonces el documento queda "eliminado" y la cuota usada baja en 1250000 bytes
  Y el gasto y su asiento no cambian
```

## Notas

- Change: `add-document-attachments`. Requirement: "Eliminar un documento" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
