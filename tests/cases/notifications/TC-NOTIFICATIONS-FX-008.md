---
id: TC-NOTIFICATIONS-FX-008
title: "De punta a punta: caída del provider, alerta, recuperación y revisión de una anomalía desde la notificación"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Notificación de par sin tasa fresca"
scenario: null
requirement_status: confirmed
fr: ["FR-NOTIFY-004", "FR-FX-010"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/api/test/api/fx-feed-alerts.api.test.ts
  - tests/e2e/specs/fx-feed-alerts.spec.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "e2e"]
error_code: null
preconditions:
  - "Stack E2E con providers simulados y reloj controlable; OWNER autenticado"
input: {}
steps:
  - "Simular la caída de los providers y avanzar el reloj más de 6 h"
  - "Abrir el centro de notificaciones"
  - "Restablecer el provider y correr un ciclo"
  - "Inyectar una muestra anómala y confirmarla desde el enlace de su notificación"
expected_result:
  - "Aparece la alerta de obsolescencia con enlace al estado por par"
  - "Aparece la de recuperación"
  - "La anomalía se confirma desde el enlace y la valoración cambia"
  - "Sin violaciones de axe"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-008 — De punta a punta: caída del provider, alerta, recuperación y revisión de una anomalía desde la notificación

## Intención

Evidencia automatizada del criterio de salida "alertas de obsolescencia funcionando".

## Escenario

```gherkin
Dado el provider caído más de 6 h
Cuando el OWNER abre las notificaciones
Entonces ve la alerta y luego la recuperación
```

## Notas

- Ejecutar con PF_E2E_PROJECT=pfos-e2e-<nombre>.
