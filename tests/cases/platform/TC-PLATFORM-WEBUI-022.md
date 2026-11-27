---
id: TC-PLATFORM-WEBUI-022
title: "El aviso se anuncia una vez en el idioma de la interfaz"
spec: platform/web-interface
related_specs: []
requirement: "Región de avisos de la sesión"
scenario: "Anuncio en el idioma de la interfaz"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-108","NFR-USAB-001"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/notices-state.test.ts
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["notices","a11y","i18n"]
error_code: null
preconditions:
  - "la interfaz en inglés (/en/...)"
  - "un EDITOR en el alta"
input:
  monto: "45.00"
  moneda: "BOB"
steps:
  - "el usuario registra un gasto de 45.00 BOB"
expected_result:
  - "si el navegador tiene ariaNotify, se llamó una sola vez con el texto del catálogo en inglés"
  - "si no, el role=\"status\" de la región contiene una sola vez ese texto"
  - "las claves del aviso existen en es, en y pt"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-022 — El aviso se anuncia una vez en el idioma de la interfaz

## Intención

Comprueba el anuncio con ariaNotify (Newly 2026-09) y su respaldo role="status", siempre en el idioma de la UI.

## Escenario

```gherkin
Dado la interfaz en inglés (/en/...)
  Y un EDITOR en el alta
Cuando el usuario registra un gasto de 45.00 BOB
Entonces si el navegador tiene ariaNotify, se llamó una sola vez con el texto del catálogo en inglés
  Y si no, el role="status" de la región contiene una sola vez ese texto
  Y las claves del aviso existen en es, en y pt
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
