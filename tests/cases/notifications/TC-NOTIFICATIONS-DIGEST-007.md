---
id: TC-NOTIFICATIONS-DIGEST-007
title: "La frecuencia del digest viaja en el export y un archivo anterior la importa desactivada"
spec: notifications/alerts
related_specs: []
requirement: "Frecuencia del digest en la portabilidad del workspace"
scenario: "Exportar e importar el digest semanal"
requirement_status: confirmed
fr: ["FR-NOTIFY-007","FR-IDENTITY-010"]
nfr: []
invariants: []
priority: low
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/workspace-export-digest.api.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","digest","portability"]
error_code: null
preconditions:
  - "OWNER con digest semanal"
input: {}
steps:
  - "Exportar e importar el workspace"
  - "Importar un archivo exportado antes del cambio"
expected_result:
  - "Preferencias importadas con digest semanal"
  - "Archivo anterior: digest desactivado"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-DIGEST-007 — La frecuencia del digest viaja en el export y un archivo anterior la importa desactivada

## Intención

Portabilidad compatible hacia atrás.

## Escenario

```gherkin
Dado OWNER con digest semanal
Cuando Exportar e importar el workspace
Entonces Preferencias importadas con digest semanal
  Y Archivo anterior: digest desactivado
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Frecuencia del digest en la portabilidad del workspace" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
