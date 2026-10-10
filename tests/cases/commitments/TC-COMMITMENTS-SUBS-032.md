---
id: TC-COMMITMENTS-SUBS-032
title: 'Un cambio de precio detectado notifica a OWNER y EDITOR y uno manual no notifica'
spec: notifications/alerts
related_specs: ['commitments/subscriptions']
requirement: 'Notificación de posible cambio de precio de una suscripción'
scenario: 'Aumento detectado de MusicBox'
requirement_status: provisional
fr: ['FR-NOTIFY-004', 'FR-NOTIFY-005', 'FR-COMMITMENTS-014']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['notifications', 'subscriptions', 'price-detection']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Miembros activos OWNER, EDITOR y VIEWER'
input:
  events: ['SubscriptionPriceChanged.v1 origin DETECTED MusicBox 9.99→11.99 USD "+20.02"', 'SubscriptionPriceChanged.v1 origin MANUAL Streamly 10.99→12.99 USD']
steps:
  - 'Entregar ambos hechos'
expected_result:
  - 'OWNER y EDITOR: una notificación SUBSCRIPTION_PRICE_CHANGE de "MusicBox" 9.99 → 11.99 USD (+20.02 %) con enlace a la propuesta'
  - 'VIEWER: ninguna'
  - 'Hecho MANUAL: ninguna notificación (inbox registrado)'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-SUBS-032 — Un cambio de precio detectado notifica a OWNER y EDITOR y uno manual no notifica

## Intención

Avisar solo cuando hay una acción pendiente (aceptar/rechazar la propuesta).

## Escenario

```gherkin
Cuando se publica el cambio detectado de "MusicBox"
Entonces el OWNER y el EDITOR tienen la notificación
  Y el VIEWER no
Cuando se publica el cambio manual de "Streamly"
Entonces no se crea ninguna notificación
```

## Notas

- Cubre el scenario "Cambio registrado a mano".
- Change: `add-subscriptions` (borrador; cifras con `FixedClock` en America/La_Paz).
