---
id: TC-PLATFORM-THEME-002
title: "La página pasa a oscuro sin recargar cuando cambia el sistema"
spec: platform/web-interface
related_specs: []
requirement: "Tema según la preferencia del sistema"
scenario: "El sistema cambia con la página abierta"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "dark-mode"]
error_code: null
preconditions:
  - "preferencia «Sistema»"
input: {}
steps:
  - "el OWNER abre Transacciones con colorScheme light"
  - "escribe \"super\" en la búsqueda"
  - "page.emulateMedia({ colorScheme: \"dark\" })"
expected_result:
  - "el fondo calculado pasa al del tema oscuro"
  - "no hubo navegación nueva"
  - "la búsqueda conserva \"super\""
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-002 — La página pasa a oscuro sin recargar cuando cambia el sistema

## Intención

Verifica el requirement «Tema según la preferencia del sistema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado preferencia «Sistema»
Cuando el OWNER abre Transacciones con colorScheme light
  Y escribe "super" en la búsqueda
  Y page.emulateMedia({ colorScheme: "dark" })
Entonces el fondo calculado pasa al del tema oscuro
  Y no hubo navegación nueva
  Y la búsqueda conserva "super"
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
