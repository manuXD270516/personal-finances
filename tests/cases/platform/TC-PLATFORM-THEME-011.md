---
id: TC-PLATFORM-THEME-011
title: "El tema cambiado en otro dispositivo se adopta al leer el perfil"
spec: platform/web-interface
related_specs: []
requirement: "Tema aplicado desde la primera pintura"
scenario: "Tema cambiado en otro dispositivo"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "sync"]
error_code: null
preconditions:
  - "preferences.theme = \"dark\" guardado por API en otra sesión"
input: {}
steps:
  - "con la cookie pfos_theme=light y el perfil en «Oscuro», el OWNER abre Inicio"
  - "espera la carga del perfil"
  - "abre Transacciones"
expected_result:
  - "Inicio pasa a oscuro tras leer /me y la cookie pasa a dark"
  - "el HTML crudo de Transacciones ya tiene data-theme=\"dark\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-011 — El tema cambiado en otro dispositivo se adopta al leer el perfil

## Intención

Verifica el requirement «Tema aplicado desde la primera pintura» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado preferences.theme = "dark" guardado por API en otra sesión
Cuando con la cookie pfos_theme=light y el perfil en «Oscuro», el OWNER abre Inicio
  Y espera la carga del perfil
  Y abre Transacciones
Entonces Inicio pasa a oscuro tras leer /me y la cookie pasa a dark
  Y el HTML crudo de Transacciones ya tiene data-theme="dark"
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
