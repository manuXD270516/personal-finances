---
id: TC-DEBT-CARD-021
title: 'Alertas de utilización una vez por cruce y rearme al bajar'
spec: debt/credit-cards
related_specs: []
requirement: 'Alertas de utilización'
scenario: 'Dos umbrales en un solo cambio'
requirement_status: provisional
fr: ['FR-DEBT-015', 'FR-NOTIFY-005']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'utilization', 'alerts']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Umbrales 30.00 y 80.00 %'
input:
  shared: '26.53 % + compra 600.00 BOB → 30.53 %; +100.00 BOB → 31.20 %; pago → 12.00 %; compras → 30.10 %'
  separate: 'Visa Oro USD 200.00/1000.00 USD + compra 650.00 USD'
steps:
  - 'Postear cada movimiento y procesar debt.card-activity (incluido con eventos duplicados y concurrentes)'
expected_result:
  - 'Hecho umbral 30.00 % al pasar a 30.53 %'
  - 'Nada al pasar a 31.20 %'
  - 'Nuevo hecho 30.00 % al volver a 30.10 % tras bajar a 12.00 %'
  - 'USD: un único hecho 80.00 % con alsoCrossed [30.00]'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-021 — Alertas de utilización una vez por cruce y rearme al bajar

## Intención

Una alerta por cruce (patrón D80) sin spam mientras la utilización sigue arriba.

## Escenario

```gherkin
Dado "Visa Oro USD" al 20.00 %
Cuando se postea una compra de 650.00 USD
Entonces se publica un único hecho de umbral 80.00 % que también cruzó el 30.00 %
```

## Notas

- Cubre "Cruce del 30 %", "Sin repetir mientras sigue arriba" y "Vuelve a avisar tras bajar".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
