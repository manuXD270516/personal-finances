---
id: TC-IMPORTS-BANKING-030
title: "Una caída del worker a mitad de la sincronización se reanuda sin duplicados"
spec: imports/banking-providers
related_specs: []
requirement: "Límites del proveedor y reintentos"
scenario: null
requirement_status: provisional
fr: ["FR-IMPORTS-013"]
nfr: ["NFR-REL-007", "NFR-REL-009"]
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
input: {"crashAfterPage":3}
steps:
  - "Detener el job tras escribir la página 3"
  - "Reanudar"
expected_result:
  - "La vista previa final contiene cada registro una vez"
  - "El import no figura COMPLETED antes de terminar"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-030 — Una caída del worker a mitad de la sincronización se reanuda sin duplicados

## Intención

Páginas en transacciones cortas con cursor provisional.

## Escenario

```gherkin
Dada una sincronización interrumpida tras la página 3
Cuando se reanuda
Entonces no hay registros repetidos
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
