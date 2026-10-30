---
id: TC-SECURITY-UPLOAD-022
title: "Suite de uploads maliciosos de punta a punta: ningún caso queda disponible (exit criterion Phase 6)"
spec: security/file-upload-security
related_specs: []
requirement: "Suite de archivos maliciosos rechazados"
scenario: "Corrida completa de la suite"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: security
level: security
automation_status: automated
automated_tests: ["apps/api/test/api/upload-security.api.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "malicious-suite"
  - "exit-criterion"
  - "phase-6"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "API, PostgreSQL y SeaweedFS reales (Testcontainers)"
  - "Casos generados por apps/api/test/support/malicious-files.ts"
  - "Con escáner: job nightly con ClamAV (pregunta 2)"
input:
  casos: "los 18 de design.md § Suite (1–17 siempre; 18 con escáner)"
steps:
  - "Ejecutar cada caso por la API y el almacenamiento reales"
  - "Registrar la etapa de rechazo de cada uno"
  - "Listar documentos AVAILABLE, la cuarentena y el bucket de documentos"
  - "Intentar descargar cada documento creado"
expected_result:
  - "17 (o 18) rechazados en la etapa esperada"
  - "0 documentos AVAILABLE, cuarentena vacía y ningún objeto en el bucket de documentos"
  - "Toda descarga intentada ⇒ DOCUMENT_REJECTED o DOCUMENT_NOT_AVAILABLE"
  - "El reporte del test lista caso, etapa y motivo"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-022 — Suite de uploads maliciosos de punta a punta: ningún caso queda disponible (exit criterion Phase 6)

## Intención

Evidencia del criterio de salida "uploads maliciosos de prueba rechazados" (docs/24 §5.6, docs/12 §16).

## Escenario

```gherkin
Dado el conjunto de casos maliciosos de la suite
Cuando se ejecuta contra la API y el almacenamiento reales
Entonces todos terminan rechazados en la solicitud, en el almacenamiento o en la verificación
  Y el workspace no tiene ningún documento disponible y la cuarentena queda vacía
```

## Notas

- Change: `add-document-attachments`. Requirement: "Suite de archivos maliciosos rechazados" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
