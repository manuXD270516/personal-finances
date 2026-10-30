---
id: TC-DOCUMENTS-ATTACH-022
title: "Adjuntar, descargar y ver el rechazo de un archivo desde el detalle de un gasto"
spec: documents/attachments
related_specs: []
requirement: "Adjuntos en la interfaz"
scenario: null
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-003"
  - "FR-DOCUMENTS-004"
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests: ["apps/web/src/ui/documents/logic.test.ts", "tests/e2e/specs/documents.spec.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "ui"
  - "i18n"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Gasto de 150.00 BOB"
  - "Fixtures \"ticket-supermercado.jpg\" y un PNG renombrado \"factura.pdf\""
input:
  usuario: "editor"
  ui: "detalle del gasto → Adjuntos"
steps:
  - "Elegir \"ticket-supermercado.jpg\" y esperar el fin del progreso"
  - "Descargarlo"
  - "Elegir \"factura.pdf\" (PNG)"
  - "Repetir en inglés y portugués"
expected_result:
  - "El adjunto aparece con nombre y tamaño y botón de descarga; el progreso se anuncia por aria-live"
  - "La descarga trae el archivo original"
  - "Se muestra el motivo \"el contenido no coincide con su tipo\" y no se adjunta"
  - "Textos traducidos en es/en/pt"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-022 — Adjuntar, descargar y ver el rechazo de un archivo desde el detalle de un gasto

## Intención

Recorrido de usuario del componente "Adjuntos" (docs/28).

## Escenario

```gherkin
Dado el gasto de 150.00 BOB abierto por el EDITOR
Cuando elige "ticket-supermercado.jpg" y la subida termina
Entonces el detalle muestra el adjunto con su nombre, tamaño y botón de descarga
Y cuando elige un PNG llamado "factura.pdf" la interfaz muestra el rechazo y no lo adjunta
```

## Notas

- Change: `add-document-attachments`. Requirement: "Adjuntos en la interfaz" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
