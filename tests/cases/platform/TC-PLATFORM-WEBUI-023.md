---
id: TC-PLATFORM-WEBUI-023
title: "Al recargar la página la región de avisos queda vacía"
spec: platform/web-interface
related_specs: []
requirement: "Región de avisos de la sesión"
scenario: "Recarga de la página"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["notices"]
error_code: null
preconditions:
  - "un aviso de registro visible en el alta"
input: {}
steps:
  - "el usuario recarga la página"
expected_result:
  - "la región de avisos existe y está vacía"
  - "sessionStorage y localStorage no tienen claves de avisos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-023 — Al recargar la página la región de avisos queda vacía

## Intención

Evita un "Deshacer" que reaparece tras recargar y apunta a una acción vencida (docs/78 § 11.1 punto 3).

## Escenario

```gherkin
Dado un aviso de registro visible en el alta
Cuando el usuario recarga la página
Entonces la región de avisos existe y está vacía
  Y sessionStorage y localStorage no tienen claves de avisos
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
