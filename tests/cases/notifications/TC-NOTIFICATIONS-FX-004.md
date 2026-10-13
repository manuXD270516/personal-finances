---
id: TC-NOTIFICATIONS-FX-004
title: "Una muestra retenida notifica a OWNER y EDITOR con enlace a su revisión, desde donde se confirma"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de muestra anómala retenida"
scenario: "Bitcoin retenido"
requirement_status: confirmed
fr: ["FR-NOTIFY-004", "FR-FX-010"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/fx-feed-alerts.api.test.ts
  - packages/contexts/notifications/src/application/notification-intake.test.ts
  - packages/contexts/notifications/src/domain/fx-rate-notifications.test.ts
  - apps/web/src/ui/notifications/notifications.test.tsx
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "anomaly"]
error_code: null
preconditions:
  - "Muestra BTC/USDT 72000.00 retenida con línea base 65000.00 en W1"
input: {"rateId": "<id de la muestra>"}
steps:
  - "GET W/notifications como OWNER"
  - "Seguir el enlace y POST W/fx-rates/{id}/anomaly-review con CONFIRM y motivo"
expected_result:
  - "Notificación FX_RATE_ANOMALY_RETAINED con BTC/USDT, provider, 72000.00, 65000.00 y +10.77 %"
  - "El enlace apunta a la revisión de esa tasa"
  - "Tras confirmar, la valoración usa 72000.00 y la notificación no se duplica"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-004 — Una muestra retenida notifica a OWNER y EDITOR con enlace a su revisión, desde donde se confirma

## Intención

D234: el aviso reduce la espera de una muestra retenida (D236).

## Escenario

```gherkin
Dado BTC/USDT 72000.00 retenido
Cuando el OWNER abre la notificación
Entonces llega a la revisión y puede confirmar
```

## Notas

