---
id: TC-PLATFORM-WEBUI-011
title: "Cancelar la pausa en línea de una suscripción devuelve el foco a Pausar"
spec: platform/web-interface
related_specs: ["commitments/subscriptions"]
requirement: "Confirmaciones en línea que devuelven el foco"
scenario: "Cancelar la pausa de una suscripción"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["a11y","focus"]
error_code: null
preconditions:
  - "un EDITOR con sesión y una suscripción activa"
input: {}
steps:
  - "el usuario pulsa \"Pausar\""
  - "en la confirmación en línea pulsa \"Cancelar\""
expected_result:
  - "al abrirse la confirmación, el foco estaba en \"Cancelar\", que precede a la acción de pausar"
  - "la confirmación desaparece y el foco vuelve al botón \"Pausar\""
  - "la suscripción sigue activa"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-011 — Cancelar la pausa en línea de una suscripción devuelve el foco a Pausar

## Intención

Verifica M-06 nivel (a): las confirmaciones reversibles siguen en línea pero empiezan en la acción segura y devuelven el foco.

## Escenario

```gherkin
Dado un EDITOR con sesión y una suscripción activa
Cuando el usuario pulsa "Pausar"
  Y en la confirmación en línea pulsa "Cancelar"
Entonces al abrirse la confirmación, el foco estaba en "Cancelar", que precede a la acción de pausar
  Y la confirmación desaparece y el foco vuelve al botón "Pausar"
  Y la suscripción sigue activa
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
