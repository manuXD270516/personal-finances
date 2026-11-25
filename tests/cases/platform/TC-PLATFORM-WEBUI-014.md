---
id: TC-PLATFORM-WEBUI-014
title: "Ninguna hoja de estilo fuerza duraciones globales ni anima movimiento sin consulta de preferencia"
spec: platform/web-interface
related_specs: []
requirement: "Movimiento reducido declarado por componente"
scenario: "Revisión de las hojas de estilo"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107"]
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["motion","css"]
error_code: null
preconditions:
  - "las hojas app/globals.css y src/**/*.css de apps/web"
input: {}
steps:
  - "el test lee cada hoja con node:fs y busca reglas universales con animation-duration o transition-duration con !important y animaciones con transform fuera de una consulta no-preference"
expected_result:
  - "no hay ninguna regla universal que fuerce duraciones"
  - "toda animación o transición de transform está dentro de @media (prefers-reduced-motion: no-preference)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-014 — Ninguna hoja de estilo fuerza duraciones globales ni anima movimiento sin consulta de preferencia

## Intención

Protege contra la vuelta de la anulación global y contra animaciones de movimiento nuevas sin variante.

## Escenario

```gherkin
Dado las hojas app/globals.css y src/**/*.css de apps/web
Cuando el test lee cada hoja con node:fs y busca reglas universales con animation-duration o transition-duration con !important y animaciones con transform fuera de una consulta no-preference
Entonces no hay ninguna regla universal que fuerce duraciones
  Y toda animación o transición de transform está dentro de @media (prefers-reduced-motion: no-preference)
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
