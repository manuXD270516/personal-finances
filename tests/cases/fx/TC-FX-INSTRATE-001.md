---
id: TC-FX-INSTRATE-001
title: "Un proveedor de tasas por institución sin verificación registrada queda deshabilitado sin enviar solicitudes"
spec: fx/market-rate-providers
related_specs: []
requirement: "Proveedores de tasas por institución solo con términos verificados"
scenario: "Proveedor sin verificación configurado"
requirement_status: provisional
fr: ["FR-FX-009", "FR-FX-015"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: critical
type: unit
level: architecture
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "terms-of-use", "config"]
error_code: "FX_PROVIDER_CONFIG_INVALID"
preconditions:
  - "Descriptores de proveedores con estado de términos"
input: {"FX_PROVIDER_INSTITUTION_RATES": "<id sin verificación>"}
steps:
  - "Validar la configuración"
  - "Test de arquitectura sobre los adapters registrados"
  - "Verificar con un servidor local que no hubo solicitudes"
expected_result:
  - "FX_PROVIDER_CONFIG_INVALID; el proveedor no se inicia y los demás siguen"
  - "Todo adapter por institución registrado tiene descriptor VERIFIED con fecha y ADR"
  - "Cero solicitudes"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-INSTRATE-001 — Un proveedor de tasas por institución sin verificación registrada queda deshabilitado sin enviar solicitudes

## Intención

NFR-COMP-007 y RISK-023: 'soportar todas' no autoriza consultar fuentes sin verificar.

## Escenario

```gherkin
Dado un proveedor sin verificación
Cuando se configura
Entonces no se inicia
  Y no envía solicitudes
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
