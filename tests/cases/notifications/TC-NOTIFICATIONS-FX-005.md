---
id: TC-NOTIFICATIONS-FX-005
title: "Los emails de tasas no muestran valores, monedas ni providers sin opt-in de detalles"
spec: notifications/alerts
related_specs: []
requirement: "Emails de tasas sin valores salvo opt-in"
scenario: "Email de anomalía sin detalles"
requirement_status: provisional
fr: ["FR-NOTIFY-006"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["notifications", "fx", "email", "privacy"]
error_code: null
preconditions:
  - "OWNER con email activo y sin opt-in de detalles; SMTP de prueba (Mailpit)"
input: {"pair": "BTC/USDT", "value": "72000.00"}
steps:
  - "Notificar la muestra retenida y la obsolescencia de USDT/BOB"
  - "Leer los emails en Mailpit"
  - "Activar el opt-in y repetir con otro hecho"
expected_result:
  - "Sin opt-in: el email dice que una tasa quedó retenida y enlaza a la app autenticada; no contiene 72000.00, 65000.00, 10.77, BTC, USDT, BOB ni el nombre del provider"
  - "Con opt-in: el email incluye el par y los valores"
created: 2026-10-13
updated: 2026-10-13
---

# TC-NOTIFICATIONS-FX-005 — Los emails de tasas no muestran valores, monedas ni providers sin opt-in de detalles

## Intención

D235 y FR-NOTIFY-006: una sola regla para todos los emails; los pares revelan las tenencias del owner.

## Escenario

```gherkin
Dado el OWNER sin opt-in
Cuando recibe el email de anomalía
Entonces no ve valores ni monedas
```

## Notas

