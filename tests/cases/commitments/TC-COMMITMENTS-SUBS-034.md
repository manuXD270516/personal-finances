---
id: TC-COMMITMENTS-SUBS-034
title: 'Las notificaciones de suscripciones se presentan en inglés y portugués según el locale'
spec: notifications/alerts
related_specs: ['commitments/subscriptions']
requirement: 'Idioma de las notificaciones de suscripciones'
scenario: 'Renovación en inglés'
requirement_status: provisional
fr: ['FR-NOTIFY-002']
nfr: ['NFR-USAB-001', 'NFR-USAB-002']
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['notifications', 'i18n', 'subscriptions']
error_code: null
preconditions:
  - 'Catálogo de mensajes es/en/pt de los tres tipos de suscripción'
input:
  locales: ['en-US', 'pt-BR', 'fr-FR']
steps:
  - 'Renderizar asunto y cuerpo de la renovación (en-US), del cambio de precio (pt-BR) y de la renovación (fr-FR)'
expected_result:
  - 'en-US: asunto "You have an upcoming subscription renewal"'
  - 'pt-BR: asunto "Detectamos uma possível mudança de preço"'
  - 'fr-FR: texto en español (respaldo)'
  - 'Montos y fechas con el formato del locale'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-034 — Las notificaciones de suscripciones se presentan en inglés y portugués según el locale

## Intención

NFR-USAB-001: i18n es/en/pt como las alertas de Phase 2.

## Escenario

```gherkin
Dado el OWNER con locale "en-US"
Cuando recibe la renovación de "Streamly"
Entonces el asunto es "You have an upcoming subscription renewal"
```

## Notas

- Cubre el scenario "Cambio de precio en portugués".
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
