---
id: TC-PLATFORM-THEME-009
title: "Con «Claro» y el sistema oscuro, el HTML del servidor ya sale claro"
spec: platform/web-interface
related_specs: []
requirement: "Tema aplicado desde la primera pintura"
scenario: "Claro elegido con el sistema en oscuro"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "ssr", "no-flash"]
error_code: null
preconditions:
  - "perfil con tema «Claro»"
  - "cookie pfos_theme=light"
input: {}
steps:
  - "el OWNER abre /reportes con colorScheme dark"
  - "se lee el HTML crudo de la respuesta y se toma una captura al terminar domcontentloaded"
expected_result:
  - "el HTML crudo tiene <html data-theme=\"light\"> y <meta name=\"color-scheme\" content=\"light\">"
  - "la captura temprana tiene el fondo claro"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-009 — Con «Claro» y el sistema oscuro, el HTML del servidor ya sale claro

## Intención

Verifica el requirement «Tema aplicado desde la primera pintura» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado perfil con tema «Claro»
  Y cookie pfos_theme=light
Cuando el OWNER abre /reportes con colorScheme dark
  Y se lee el HTML crudo de la respuesta y se toma una captura al terminar domcontentloaded
Entonces el HTML crudo tiene <html data-theme="light"> y <meta name="color-scheme" content="light">
  Y la captura temprana tiene el fondo claro
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
