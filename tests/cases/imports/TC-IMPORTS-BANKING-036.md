---
id: TC-IMPORTS-BANKING-036
title: "El export lleva la conexión sin credenciales y la importación pide una nueva"
spec: identity/workspace-portability
related_specs: ["imports/banking-providers"]
requirement: "Conexiones con proveedores en el export sin credenciales"
scenario: "Ida y vuelta de una conexión de exchange"
requirement_status: provisional
fr: ["FR-IDENTITY-010", "FR-IDENTITY-017"]
nfr: ["NFR-COMP-008"]
invariants: []
priority: critical
type: integration
level: api
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
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC con 37 transacciones importadas"
input: {}
steps:
  - "Exportar W1 y buscar el secreto y wrapped_dek en el archivo"
  - "Importar en un workspace nuevo"
  - "Sincronizar antes de cargar la credencial"
expected_result:
  - "El archivo no contiene el secreto ni la clave envuelta"
  - "Conexión con dos mapeos en NEEDS_CREDENTIAL y 37 transacciones"
  - "sync ⇒ 409 INVALID_STATUS_TRANSITION"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-036 — El export lleva la conexión sin credenciales y la importación pide una nueva

## Intención

Portabilidad sin credenciales.

## Escenario

```gherkin
Dada la conexión activa con 37 transacciones
Cuando exporto e importo el workspace
Entonces la conexión llega sin credencial y requiere una nueva
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
