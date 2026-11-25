---
id: TC-PLATFORM-WEBUI-015
title: "En colores forzados el ítem actual de la navegación tiene un borde visible"
spec: platform/web-interface
related_specs: []
requirement: "Sección actual visible en colores forzados"
scenario: "Alto contraste de Windows"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101","NFR-USAB-104"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["a11y","forced-colors","navigation"]
error_code: null
preconditions:
  - "Playwright con forcedColors: 'active'"
  - "un usuario con sesión"
input: {}
steps:
  - "el usuario abre \"Transacciones\""
expected_result:
  - "el enlace con aria-current=\"page\" tiene un border-inline-start de ancho mayor que cero"
  - "los demás enlaces de la navegación no lo tienen"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-015 — En colores forzados el ítem actual de la navegación tiene un borde visible

## Intención

Verifica M-14: el fondo y la sombra del ítem activo desaparecen en colores forzados; el borde con currentColor no.

## Escenario

```gherkin
Dado Playwright con forcedColors: 'active'
  Y un usuario con sesión
Cuando el usuario abre "Transacciones"
Entonces el enlace con aria-current="page" tiene un border-inline-start de ancho mayor que cero
  Y los demás enlaces de la navegación no lo tienen
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
