---
id: TC-NOTIFICATIONS-DIGEST-008
title: "El digest usa el idioma del destinatario con español como respaldo"
spec: notifications/alerts
related_specs: []
requirement: "Idioma de las notificaciones de déficit y del digest"
scenario: "Locale no soportado"
requirement_status: confirmed
fr: ["FR-NOTIFY-002","FR-NOTIFY-007"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: low
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/domain/home-digest.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["notifications","digest","i18n"]
error_code: null
preconditions:
  - "OWNER con locale fr-FR y otro con pt-BR"
input: {}
steps:
  - "Renderizar el digest semanal para ambos"
expected_result:
  - "fr-FR: español"
  - "pt-BR: portugués"
created: 2026-11-04
updated: 2026-11-07
---

# TC-NOTIFICATIONS-DIGEST-008 — El digest usa el idioma del destinatario con español como respaldo

## Intención

i18n del digest (NFR-USAB-001).

## Escenario

```gherkin
Dado OWNER con locale fr-FR y otro con pt-BR
Cuando Renderizar el digest semanal para ambos
Entonces fr-FR: español
  Y pt-BR: portugués
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Idioma de las notificaciones de déficit y del digest" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
