---
id: TC-ACCOUNTS-INSTCATALOG-008
title: "Sin pendientes activos el soporte es completo y las entradas retiradas no cuentan"
spec: accounts/institutions
related_specs: []
requirement: "Medición del soporte completo"
scenario: "Las entradas retiradas no cuentan"
requirement_status: confirmed
fr: ["FR-ACCOUNTS-012"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/accounts/catalog.test.tsx
  - packages/contexts/accounts/src/domain/support-coverage.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog", "coverage"]
error_code: null
preconditions:
  - "Censo BO de 3 entidades"
input: {"CID": {"listing": "DELISTED", "rates": "IN_VERIFICATION"}}
steps:
  - "Calcular la cobertura con todas las activas resueltas y CID DELISTED pendiente"
expected_result:
  - "complete = true con el desglose por estado y razón"
  - "CID no cuenta como pendiente"
created: 2026-10-13
updated: 2026-10-15
---

# TC-ACCOUNTS-INSTCATALOG-008 — Sin pendientes activos el soporte es completo y las entradas retiradas no cuentan

## Intención

El indicador solo mide entidades vigentes.

## Escenario

```gherkin
Dado CID retirada y pendiente
Cuando se calcula la cobertura
Entonces el soporte es completo
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
