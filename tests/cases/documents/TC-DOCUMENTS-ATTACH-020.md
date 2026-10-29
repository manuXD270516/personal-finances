---
id: TC-DOCUMENTS-ATTACH-020
title: "El pipeline de importación lee en streaming el extracto disponible y lo vincula en su unidad de trabajo"
spec: documents/attachments
related_specs: []
requirement: "Lectura de documentos para el pipeline de importación"
scenario: null
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-003"
  - "FR-IMPORTS-002"
nfr: []
invariants:
  - "INV-029"
priority: critical
type: integration
level: container-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "imports"
  - "contracts"
error_code: DOCUMENT_NOT_AVAILABLE
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "\"extracto-oct.csv\" sintético de 18874368 bytes AVAILABLE con propósito IMPORT_SOURCE"
  - "Otro documento PENDING_UPLOAD"
  - "Una importación de W1"
input:
  contratos:
    - "DocumentQuery.getForProcessing"
    - "DocumentContentReader.open"
    - "AttachmentCommand.link (UoW del llamador)"
steps:
  - "Consultar el documento"
  - "Leer el flujo completo midiendo la memoria retenida"
  - "Vincularlo a la importación en una UoW que luego se revierte, y en otra que confirma"
  - "Leer el documento pendiente"
  - "Alterar un byte del objeto cifrado y leer de nuevo"
expected_result:
  - "detectedFormat CSV, sizeBytes 18874368 y suma igual; el flujo coincide byte a byte"
  - "La memoria retenida por el lector no crece con el tamaño del archivo (bloques de 64 KiB)"
  - "El vínculo IMPORT_JOB existe solo tras la UoW confirmada"
  - "Pendiente ⇒ DOCUMENT_NOT_AVAILABLE; alterado ⇒ error de integridad sin emitir el bloque alterado"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-020 — El pipeline de importación lee en streaming el extracto disponible y lo vincula en su unidad de trabajo

## Intención

Contrato que consume add-import-pipeline (design.md decisión 14).

## Escenario

```gherkin
Dado "extracto-oct.csv" disponible con propósito extracto para importar
Cuando el procesamiento de importaciones lo lee
Entonces recibe formato CSV, 18874368 bytes y un flujo idéntico al subido
```

## Notas

- Change: `add-document-attachments`. Requirement: "Lectura de documentos para el pipeline de importación" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
