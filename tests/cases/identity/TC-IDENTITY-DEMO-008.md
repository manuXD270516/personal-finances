---
id: TC-IDENTITY-DEMO-008
title: "Una carga fallida queda en FAILED y nunca se presenta como lista"
spec: identity/demo-data
related_specs: []
requirement: "Estado de la carga observable y sin resultados parciales"
scenario: "Carga fallida"
requirement_status: confirmed
fr: ["FR-IDENTITY-013"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["demo-data","failure"]
error_code: null
preconditions:
  - "Generador del módulo transactions configurado para fallar en el mes 2025-06 (doble de prueba)"
input: {"failAt":"transactions/2025-06"}
steps:
  - "Cargar la demo"
  - "Consultar el estado y la lista de workspaces"
expected_result:
  - "El estado del workspace demo es FAILED con un código de error"
  - "El workspace demo no se presenta como listo y la UI ofrece \"Limpiar datos de demostración\""
  - "La limpieza posterior funciona igual que con un demo READY"
created: 2026-10-03
updated: 2026-10-03
---

# TC-IDENTITY-DEMO-008 — Una carga fallida queda en FAILED y nunca se presenta como lista

## Intención

Una demo a medias confundiría al usuario y rompería el golden: o está completa o está marcada como fallida.

## Escenario

```gherkin
Dado que la carga falla a mitad de la generación
Cuando consulto el estado de la demo
Entonces veo FAILED
  Y puedo limpiarla
```

## Notas

