---
id: TC-ACCOUNTS-INSTCATALOG-010
title: "El archivo real del catálogo de Bolivia valida su estructura e informa su cobertura"
spec: accounts/institutions
related_specs: []
requirement: "Completitud del catálogo frente al censo oficial"
scenario: null
requirement_status: provisional
fr: ["FR-ACCOUNTS-012"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["accounts", "institutions", "catalog", "coverage"]
error_code: null
preconditions:
  - "Archivo real reference/institutions/BO.json (tarea 4.2)"
input: {"file": "reference/institutions/BO.json"}
steps:
  - "Validar el archivo con CatalogValidator"
  - "Calcular la cobertura e imprimirla en la salida del test"
expected_result:
  - "Validación estructural en verde (censo, códigos, fuente, fechas, razones, proveedores verificados)"
  - "La salida informa cobertura por categoría y dimensión; no falla por pendientes"
created: 2026-10-13
updated: 2026-10-13
---

# TC-ACCOUNTS-INSTCATALOG-010 — El archivo real del catálogo de Bolivia valida su estructura e informa su cobertura

## Intención

Mide el avance hacia el soporte completo en cada build sin bloquear CI por entidades en verificación.

## Escenario

```gherkin
Dado el catálogo real de BO
Cuando corre el test
Entonces la estructura es válida
  Y la cobertura queda informada
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
