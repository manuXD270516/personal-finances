---
id: TC-FX-INSTRATE-002
title: "Una fuente cuyos términos prohíben la automatización queda no apta y no se consulta"
spec: fx/market-rate-providers
related_specs: []
requirement: "Proveedores de tasas por institución solo con términos verificados"
scenario: "Fuente con términos que prohíben la automatización"
requirement_status: provisional
fr: ["FR-FX-009"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: unit
level: architecture
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "terms-of-use"]
error_code: null
preconditions:
  - "Descriptor REJECTED con razón TERMS_PROHIBIT_AUTOMATION"
input: {"terms": "REJECTED"}
steps:
  - "Validar la configuración con esa fuente"
  - "Validar el catálogo con una entidad SUPPORTED por esa fuente"
expected_result:
  - "La fuente no se habilita"
  - "La validación del catálogo falla; la entidad debe quedar NOT_ELIGIBLE o IN_VERIFICATION"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-INSTRATE-002 — Una fuente cuyos términos prohíben la automatización queda no apta y no se consulta

## Intención

Una fuente rechazada no vuelve por otra vía.

## Escenario

```gherkin
Dado una fuente REJECTED
Cuando se configura
Entonces no se habilita
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
