---
id: TC-SECURITY-UPLOAD-019
title: "Con escáner EICAR se rechaza, con escáner caído falla cerrado y sin escáner queda no escaneado"
spec: security/file-upload-security
related_specs: []
requirement: "Escaneo antimalware opcional"
scenario: null
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-008"
nfr: []
invariants: []
priority: low
type: security
level: container-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "upload"
  - "malware"
  - "clamav"
  - "malicious-suite"
error_code: SERVICE_UNAVAILABLE
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "EICAR construido en memoria por fragmentos (nunca versionado completo)"
  - "Contenedor clamav/clamav fijado por digest (solo nightly, según la pregunta 2)"
input:
  casos:
    - "scanner clamav + EICAR en movimientos.csv"
    - "scanner clamav detenido"
    - "scanner none + PDF válido"
steps:
  - "Confirmar cada caso"
expected_result:
  - "REJECTED/MALWARE_DETECTED"
  - "503 SERVICE_UNAVAILABLE y el documento sigue UPLOADED"
  - "AVAILABLE con scanStatus NOT_SCANNED y descarga como adjunto"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-019 — Con escáner EICAR se rechaza, con escáner caído falla cerrado y sin escáner queda no escaneado

## Intención

Caso 18 de la suite (pregunta 2).

## Escenario

```gherkin
Dado el escáner habilitado
Cuando se sube "movimientos.csv" con la cadena de prueba EICAR
Entonces el documento queda "rechazado" con el motivo malware detectado
```

## Notas

- Change: `add-document-attachments`. Requirement: "Escaneo antimalware opcional" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
