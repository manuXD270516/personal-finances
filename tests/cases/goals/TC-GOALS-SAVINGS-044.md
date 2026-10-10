---
id: TC-GOALS-SAVINGS-044
title: "Las notificaciones de metas se renderizan en el idioma del destinatario con respaldo en español"
spec: notifications/alerts
related_specs: ["goals/savings-goals"]
requirement: "Idioma de las notificaciones de metas"
scenario: "Meta alcanzada en inglés"
requirement_status: provisional
fr: ["FR-NOTIFY-002"]
nfr: ["NFR-USAB-001", "NFR-USAB-002"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["goals", "notifications", "i18n"]
error_code: null
preconditions:
  - "OWNER con locale en-US; EDITOR con pt-BR; VIEWER con un locale sin traducción"
input: {"event": "goals.GoalReached.v1 de \"Laptop\" 9000.00 BOB"}
steps:
  - "Renderizar in-app y email para cada destinatario"
expected_result:
  - "en-US: asunto \"You reached one of your savings goals\""
  - "pt-BR: texto en portugués"
  - "Locale sin traducción: español"
  - "Montos y fechas en el formato del locale"
created: 2026-10-10
updated: 2026-10-10
---

# TC-GOALS-SAVINGS-044 — Las notificaciones de metas se renderizan en el idioma del destinatario con respaldo en español

## Intención

NFR-USAB-001/002.

## Escenario

```gherkin
Dado un OWNER con locale en-US sin opt-in de detalles
Cuando recibe la meta alcanzada de "Laptop"
Entonces el asunto es "You reached one of your savings goals"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
