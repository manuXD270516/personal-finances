---
id: TC-PLATFORM-WEBUI-018
title: "Enter durante una composición de texto no dispara la búsqueda"
spec: platform/web-interface
related_specs: ["commitments/recurrence-engine"]
requirement: "Enter durante la composición de texto"
scenario: "Búsqueda de transacción para vincular una ocurrencia"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-001","NFR-USAB-102"]
invariants: []
priority: low
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["forms","ime"]
error_code: null
preconditions:
  - "la utilidad isImeEnter y el manejador de Enter del panel de vincular"
input:
  texto: "café"
steps:
  - "se simula keydown de Enter con isComposing=true"
  - "se simula keydown de Enter con keyCode=229 e isComposing=false"
  - "se simula keydown de Enter sin composición"
expected_result:
  - "los dos primeros no disparan la búsqueda"
  - "el tercero busca \"café\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-018 — Enter durante una composición de texto no dispara la búsqueda

## Intención

Verifica M-04 con las dos comprobaciones obligatorias, porque isComposing es Limited y llega en falso en Safari.

## Escenario

```gherkin
Dado la utilidad isImeEnter y el manejador de Enter del panel de vincular
Cuando se simula keydown de Enter con isComposing=true
  Y se simula keydown de Enter con keyCode=229 e isComposing=false
  Y se simula keydown de Enter sin composición
Entonces los dos primeros no disparan la búsqueda
  Y el tercero busca "café"
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
