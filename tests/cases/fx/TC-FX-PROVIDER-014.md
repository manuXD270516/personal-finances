---
id: TC-FX-PROVIDER-014
title: "Con providers deshabilitados o lentos el core sigue funcionando con tasas manuales"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates","reporting/dashboard","transactions/conversions"]
requirement: "Funcionamiento sin providers"
scenario: "Providers deshabilitados"
requirement_status: confirmed
fr: ["FR-FX-015"]
nfr: []
invariants: ["INV-020"]
priority: critical
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["fx","provider","degradation","resilience"]
error_code: null
preconditions:
  - "Worker con FX_PROVIDER_PRIMARY=none, FX_PROVIDER_FALLBACK=none, FX_PROVIDER_OFFICIAL=none"
  - "Servidor de red simulado que falla el test si recibe cualquier solicitud"
  - "Cuenta líquida \"Wallet USDT\" 50.000000 USDT y \"Banco BOB\" 685.00 BOB"
input: {"manual_rate": {"pair": "USDT/BOB", "type": "P2P", "value": "11.98"}, "variant": {"provider_latency_seconds": 35}}
steps:
  - "Registrar la tasa manual USDT/BOB P2P 11.98"
  - "Consultar el resumen del dashboard"
  - "Registrar una conversión de 10.000000 USDT a 119.80 BOB"
  - "Variante: activar paralelo.bo simulado con 35 s de latencia y consultar el resumen durante un ciclo"
expected_result:
  - "Tasa y conversión registradas sin error"
  - "Dinero disponible (antes de la conversión): 50.000000 USDT valorados en 599.00 BOB con la tasa manual (selection MANUAL)"
  - "Cero solicitudes externas"
  - "Variante: el resumen responde sin esperar al provider; el ciclo termina en timeout (FX_PROVIDER_TIMEOUT) y queda como PROVIDER_TIMEOUT"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PROVIDER-014 — Con providers deshabilitados o lentos el core sigue funcionando con tasas manuales

## Intención

Regla del proyecto: el core funciona sin integraciones; un tercero caído no puede tumbar el producto.

## Escenario

```gherkin
Dados providers deshabilitados por configuración
  Y la tasa manual USDT/BOB P2P 11.98
Cuando consulto el dinero disponible con 50.000000 USDT
Entonces veo 599.00 BOB valorados con la tasa manual
  Y no se envió ninguna solicitud externa
```

## Notas

- 50.000000 × 11.98 = 599.00 BOB; la conversión posterior 10.000000 × 11.98 = 119.80 BOB.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
