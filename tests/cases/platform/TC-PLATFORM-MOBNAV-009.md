---
id: TC-PLATFORM-MOBNAV-009
title: "La barra lateral muestra las secciones con los grupos de docs/28"
spec: platform/web-interface
related_specs: []
requirement: "Secciones agrupadas en la barra lateral"
scenario: "Barra lateral agrupada"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["navigation", "desktop"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER abre Inicio a 1280 × 800"
expected_result:
  - "los encabezados Día a día, Planificar, Analizar, Organizar y Ajustes aparecen en ese orden"
  - "Transacciones está bajo Día a día y Reportes bajo Analizar"
  - "la navegación es un landmark con nombre"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-009 — La barra lateral muestra las secciones con los grupos de docs/28

## Intención

Verifica el requirement «Secciones agrupadas en la barra lateral» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER abre Inicio a 1280 × 800
Entonces los encabezados Día a día, Planificar, Analizar, Organizar y Ajustes aparecen en ese orden
  Y Transacciones está bajo Día a día y Reportes bajo Analizar
  Y la navegación es un landmark con nombre
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
