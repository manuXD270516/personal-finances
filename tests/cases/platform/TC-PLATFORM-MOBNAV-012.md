---
id: TC-PLATFORM-MOBNAV-012
title: "La página declara pantalla completa y la barra reserva el área segura inferior"
spec: platform/web-interface
related_specs: []
requirement: "Alto de pantalla dinámico y áreas seguras"
scenario: "Área segura inferior"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "safe-area"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "se lee el HTML crudo de Inicio"
  - "se lee el padding inferior calculado de la barra en globals.css"
expected_result:
  - "<meta name=\"viewport\"> incluye viewport-fit=cover"
  - "la regla de la barra inferior suma env(safe-area-inset-bottom)"
  - "verificación manual en un teléfono real anotada en la tarea"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-012 — La página declara pantalla completa y la barra reserva el área segura inferior

## Intención

Verifica el requirement «Alto de pantalla dinámico y áreas seguras» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando se lee el HTML crudo de Inicio
  Y se lee el padding inferior calculado de la barra en globals.css
Entonces <meta name="viewport"> incluye viewport-fit=cover
  Y la regla de la barra inferior suma env(safe-area-inset-bottom)
  Y verificación manual en un teléfono real anotada en la tarea
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
