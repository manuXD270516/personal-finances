---
id: TC-IMPORTS-BANKING-029
title: "Un 429 con Retry-After pausa y reanuda sin repetir"
spec: imports/banking-providers
related_specs: []
requirement: "Límites del proveedor y reintentos"
scenario: "Límite excedido a mitad de la sincronización"
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-REL-012", "NFR-REL-007"]
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC"
input: {"pages":10,"failAt":5,"retryAfter":120}
steps:
  - "Sincronizar con el simulado devolviendo 429 Retry-After: 120 en la página 5"
  - "Avanzar el reloj 120 s"
expected_result:
  - "retry_not_before persistido ≥ 120 s"
  - "Reanuda en la página 5"
  - "Cada registro una sola vez en la vista previa"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-029 — Un 429 con Retry-After pausa y reanuda sin repetir

## Intención

Presupuesto y espera persistida.

## Escenario

```gherkin
Dado un 429 tras 4 de 10 páginas
Cuando pasa la espera
Entonces continúa en la página 5 sin repetir registros
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
