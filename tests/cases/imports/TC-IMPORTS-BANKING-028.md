---
id: TC-IMPORTS-BANKING-028
title: "Un archivo sin formato verificado se rechaza"
spec: imports/banking-providers
related_specs: []
requirement: "Importación por archivo del historial de un exchange"
scenario: "Columnas desconocidas"
requirement_status: provisional
fr: ["FR-IMPORTS-014"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: "IMPORT_UNSUPPORTED_FORMAT"
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
input: {"file":"CSV con columnas desconocidas"}
steps:
  - "Subir el archivo"
expected_result:
  - "422 IMPORT_UNSUPPORTED_FORMAT"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-028 — Un archivo sin formato verificado se rechaza

## Intención

Formatos versionados y verificados.

## Escenario

```gherkin
Cuando subo un archivo con columnas desconocidas
Entonces se rechaza con IMPORT_UNSUPPORTED_FORMAT
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
