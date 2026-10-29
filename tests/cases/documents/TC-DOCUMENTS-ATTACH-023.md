---
id: TC-DOCUMENTS-ATTACH-023
title: "El export lleva metadatos y vínculos de documentos sin claves y la importación los remapea"
spec: identity/workspace-portability
related_specs: []
requirement: "Documentos y adjuntos en el export"
scenario: null
requirement_status: provisional
fr:
  - "FR-IDENTITY-010"
  - "FR-DOCUMENTS-003"
nfr:
  - "NFR-REL-014"
invariants: []
priority: high
type: integration
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "portability"
  - "export"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "W1 con 3 documentos AVAILABLE, 1 DELETED y 4 vínculos a dos gastos y un préstamo"
input:
  usuario: "owner"
  secuencia:
    - "POST W/exports"
    - "descargar"
    - "POST /workspace-imports"
steps:
  - "Exportar e inspeccionar las secciones documents y attachment-links"
  - "Importar"
  - "Consultar documentos y vínculos del workspace nuevo"
expected_result:
  - "Las secciones validan contra su JSON Schema y no contienen key_id, wrapped_key, object_key ni quarantine_key"
  - "El workspace nuevo tiene 4 documentos con nombres, tamaños y sumas, y 4 vínculos a las copias"
  - "3 en CONTENT_PENDING y 1 DELETED; el uso de cuota cuenta los 3"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-023 — El export lleva metadatos y vínculos de documentos sin claves y la importación los remapea

## Intención

El export sigue siendo completo para los datos de negocio (pregunta 3).

## Escenario

```gherkin
Dado "W1" con 3 documentos disponibles, 1 eliminado y 4 vínculos
Cuando el OWNER exporta e importa
Entonces el workspace nuevo tiene los 4 documentos y los 4 vínculos remapeados
  Y los 3 disponibles quedan con contenido pendiente de restaurar
```

## Notas

- Change: `add-document-attachments`. Requirement: "Documentos y adjuntos en el export" (`identity/workspace-portability`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
