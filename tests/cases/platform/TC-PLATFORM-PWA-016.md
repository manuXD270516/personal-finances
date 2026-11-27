---
id: TC-PLATFORM-PWA-016
title: "Tema oscuro en la aplicación instalada"
spec: platform/web-interface
related_specs: []
requirement: "Barra de la aplicación instalada acorde al tema"
scenario: "Tema oscuro en la aplicación instalada"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: manual
automated_tests: []
status: ready
regression_suite: false
phase: 9
tags: ["pwa", "theme", "manual"]
error_code: null
preconditions:
  - "aplicación instalada en un Android (Chrome) y en un iPhone (Safari)"
  - "tema «Oscuro» guardado en el perfil"
input: {}
steps:
  - "el OWNER, con el tema «Oscuro», abre Inicio en la aplicación instalada"
expected_result:
  - "la barra de la aplicación usa el color del tema oscuro"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PWA-016 — Tema oscuro en la aplicación instalada

## Intención

Verifica el requirement «Barra de la aplicación instalada acorde al tema» del change `add-pwa-install` (lote L6 de docs/78).

## Escenario

```gherkin
Dado aplicación instalada en un Android (Chrome) y en un iPhone (Safari)
  Y tema «Oscuro» guardado en el perfil
Cuando el OWNER, con el tema «Oscuro», abre Inicio en la aplicación instalada
Entonces la barra de la aplicación usa el color del tema oscuro
```

## Notas

- Change `add-pwa-install` (lote L6 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Requiere instalar de verdad: se verifica a mano en dispositivos (tarea 7.7). Al implementarse pasa a `automation_status: manual` y `status: ready`.
