---
id: TC-NOTIFICATIONS-DIGEST-001
title: "El usuario elige la frecuencia del digest, el cambio se audita y un valor inválido se rechaza"
spec: notifications/alerts
related_specs: []
requirement: "Frecuencia del digest en las preferencias"
scenario: "Activar el digest semanal"
requirement_status: confirmed
fr: ["FR-NOTIFY-007","FR-NOTIFY-003"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/workspace-export-digest.api.test.ts
  - apps/web/src/ui/notifications/notifications.test.tsx
  - packages/contexts/notifications/src/application/preferences.service.test.ts
  - packages/contexts/notifications/test/integration/cash-flow-digest.int.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","digest","preferences"]
error_code: VALIDATION_FAILED
preconditions:
  - "OWNER sin digest configurado"
input: {"digestFrequency":"WEEKLY"}
steps:
  - "Guardar la frecuencia semanal"
  - "Guardar la frecuencia \"DAILY\""
  - "Guardar las preferencias sin el campo digestFrequency"
expected_result:
  - "digestFrequency WEEKLY y auditoría con valor anterior OFF"
  - "DAILY: 400 VALIDATION_FAILED sin cambios"
  - "Sin el campo: la frecuencia no cambia"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-DIGEST-001 — El usuario elige la frecuencia del digest, el cambio se audita y un valor inválido se rechaza

## Intención

FR-NOTIFY-007 opt-in; entrada aditiva (campo opcional).

## Escenario

```gherkin
Dado OWNER sin digest configurado
Cuando Guardar la frecuencia semanal
Entonces digestFrequency WEEKLY y auditoría con valor anterior OFF
  Y DAILY: 400 VALIDATION_FAILED sin cambios
  Y Sin el campo: la frecuencia no cambia
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Frecuencia del digest en las preferencias" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
