---
id: TC-NOTIFICATIONS-FX-006
title: "Las notificaciones de tasas se generan en el idioma del destinatario con la hora en la zona del workspace"
spec: notifications/alerts
related_specs: []
requirement: "Idioma de las notificaciones de tasas"
scenario: "Obsolescencia en portugués"
requirement_status: provisional
fr: ["FR-NOTIFY-002"]
nfr: ["NFR-USAB-001", "NFR-USAB-002"]
invariants: []
priority: medium
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "i18n"]
error_code: null
preconditions:
  - "Workspace en America/La_Paz; destinatarios con locale es-BO, en-US y pt-BR"
input: {"lastRateAsOf": "2026-10-13T08:00:00Z"}
steps:
  - "Renderizar los tres tipos en los tres idiomas"
expected_result:
  - "pt-BR muestra 04:00 del 13/10/2026 en portugués"
  - "en-US y es-BO en su idioma y formato"
  - "Un locale no soportado usa español"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-006 — Las notificaciones de tasas se generan en el idioma del destinatario con la hora en la zona del workspace

## Intención

i18n es/en/pt obligatoria en toda la UI y las notificaciones.

## Escenario

```gherkin
Dado un EDITOR pt-BR
Cuando recibe la obsolescencia
Entonces el texto está en portugués con 04:00 del 13/10/2026
```

## Notas

