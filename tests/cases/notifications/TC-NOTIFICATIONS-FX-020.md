---
id: TC-NOTIFICATIONS-FX-020
title: "El email del grupo sin opt-in no muestra valores, monedas, providers ni cantidad"
spec: notifications/alerts
related_specs: ["fx/market-rate-providers"]
requirement: "Email único por grupo de tasas retenidas"
scenario: "Email del grupo sin detalles"
requirement_status: confirmed
fr: ["FR-NOTIFY-006"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/notifications/src/application/fx-rate-email.test.ts
  - packages/contexts/notifications/src/domain/fx-rate-notifications.test.ts
  - apps/api/test/events/notifications.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["notifications", "fx", "email", "privacy"]
error_code: null
preconditions:
  - "OWNER con email activo y sin opt-in de detalles; SMTP de prueba (Mailpit)"
  - "Aviso de USDT/BOB con 3 muestras pendientes y mayor variación 12.90 frente a 12.10 (+6.61 %) de paralelo.bo"
input: {"pendingCount": 3}
steps:
  - "Enviar la entrega de email del aviso"
  - "Leer el email en Mailpit"
expected_result:
  - "El email dice que una o más tasas automáticas quedaron retenidas y necesitan revisión, con enlace a la app autenticada"
  - "No contiene 12.90, 12.10, 6.61, USDT, BOB ni paralelo.bo, ni el número 3 como cantidad (regex con límites de palabra)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-020 — El email del grupo sin opt-in no muestra valores, monedas, providers ni cantidad

## Intención

FR-NOTIFY-006 y recomendación adoptada (pregunta 6 de design.md): sin cantidad en el email básico.

## Escenario

```gherkin
Dado el OWNER sin opt-in
Cuando recibe el email del grupo
Entonces no ve valores, monedas, providers ni cantidad
```

## Notas

- Change: `refine-rate-anomaly-alert-grouping`.
- Con Mailpit (2026-10-27, tarea 4.4): `apps/api/test/events/notifications.int.test.ts` usa el puerto de entrada real de NOTIFY sobre PostgreSQL real, el despachador real y SMTP real contra un Mailpit propio de Testcontainers: sin opt-in el email del OWNER en Mailpit dice «una o más tasas», sin valores, monedas, provider ni cantidad.
