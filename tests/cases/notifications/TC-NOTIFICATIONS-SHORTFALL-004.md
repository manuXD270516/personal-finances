---
id: TC-NOTIFICATIONS-SHORTFALL-004
title: "El riesgo de déficit se presenta en el idioma y el formato de fecha del locale del destinatario"
spec: notifications/alerts
related_specs: []
requirement: "Idioma de las notificaciones de déficit y del digest"
scenario: "Riesgo de déficit en inglés"
requirement_status: confirmed
fr: ["FR-NOTIFY-002"]
nfr: ["NFR-USAB-001","NFR-USAB-002"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/domain/cash-flow-notifications.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","shortfall","i18n"]
error_code: null
preconditions:
  - "EDITOR con locale en-US, sin opt-in"
input: {}
steps:
  - "Renderizar la notificación y el email del riesgo de BOB del 2026-11-01"
expected_result:
  - "Textos en inglés con la fecha 11/01/2026"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-SHORTFALL-004 — El riesgo de déficit se presenta en el idioma y el formato de fecha del locale del destinatario

## Intención

i18n es/en/pt de los tipos nuevos.

## Escenario

```gherkin
Dado EDITOR con locale en-US, sin opt-in
Cuando Renderizar la notificación y el email del riesgo de BOB del 2026-11-01
Entonces Textos en inglés con la fecha 11/01/2026
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Idioma de las notificaciones de déficit y del digest" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
