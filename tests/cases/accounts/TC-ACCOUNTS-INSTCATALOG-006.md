---
id: TC-ACCOUNTS-INSTCATALOG-006
title: "El estado de soporte por dimensión exige razón en NOT_ELIGIBLE y proveedor verificado en SUPPORTED"
spec: accounts/institutions
related_specs: []
requirement: "Estado de soporte por institución y dimensión"
scenario: "No apta sin razón"
requirement_status: provisional
fr: ["FR-ACCOUNTS-012", "FR-FX-009", "FR-IMPORTS-005"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog", "terms-of-use"]
error_code: null
preconditions:
  - "Catálogo ficticio con estados por dimensión"
input: {"CID": {"rates": "NOT_ELIGIBLE", "reason": null}, "BAD": {"rates": "SUPPORTED", "providerIds": ["<id sin verificación>"]}}
steps:
  - "Validar una versión con CID NOT_ELIGIBLE sin razón"
  - "Validar una versión con BAD SUPPORTED y un proveedor sin verificación"
  - "Validar una versión correcta y consultar los estados"
expected_result:
  - "Las dos primeras versiones fallan la validación"
  - "La versión correcta devuelve los estados por entrada (BAD tasas IN_VERIFICATION, importación PENDING_SAMPLE)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-ACCOUNTS-INSTCATALOG-006 — El estado de soporte por dimensión exige razón en NOT_ELIGIBLE y proveedor verificado en SUPPORTED

## Intención

Ningún estado se presenta como soportado sin evidencia (NFR-COMP-007).

## Escenario

```gherkin
Dado un catálogo con CID NOT_ELIGIBLE sin razón
Cuando se valida
Entonces falla
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
