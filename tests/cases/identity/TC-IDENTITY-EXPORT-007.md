---
id: TC-IDENTITY-EXPORT-007
title: "Un export vencido no se descarga y su archivo se elimina del almacenamiento"
spec: identity/workspace-portability
related_specs: []
requirement: "Retención y expiración del export"
scenario: "Descargar un export vencido"
requirement_status: provisional
fr: [FR-IDENTITY-010]
nfr: [NFR-COMP-005]
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["export", "retention"]
error_code: "EXPORT_EXPIRED"
preconditions:
  - "Export de \"W1\" READY el 2026-04-01T10:00:00Z con EXPORT_RETENTION = P7D"
  - "FixedClock 2026-04-08T10:00:01Z"
input:
  job: "identity.export-retention"
steps:
  - "Ejecutar el job de retención"
  - "Descargar el export"
  - "Consultar el registro del export"
expected_result:
  - "Objeto eliminado del bucket; estado EXPIRED; auditoría de expiración (actor SYSTEM)"
  - "Descarga: 410 EXPORT_EXPIRED"
  - "El registro conserva fechas, tamaño y sha256"
created: 2026-10-05
updated: 2026-10-05
---

# TC-IDENTITY-EXPORT-007 — Un export vencido no se descarga y su archivo se elimina del almacenamiento

## Intención

El export es una copia temporal: no debe quedar indefinidamente en el almacenamiento.

## Escenario

```gherkin
Dado un export terminado el 2026-04-01T10:00:00Z
Cuando el OWNER intenta descargarlo el 2026-04-08T10:00:01Z
Entonces se rechaza con "EXPORT_EXPIRED"
  Y el archivo ya no está en el almacenamiento
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
