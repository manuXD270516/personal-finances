---
id: TC-PLATFORM-THEME-010
title: "El tema oscuro no produce violaciones de la CSP"
spec: platform/web-interface
related_specs: ["security/access-control"]
requirement: "Tema aplicado desde la primera pintura"
scenario: "Sin violaciones de la política de seguridad de contenido"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "csp", "security"]
error_code: null
preconditions:
  - "perfil con tema «Oscuro»"
input: {}
steps:
  - "el OWNER recorre Inicio, Transacciones, Reportes y Preferencias con el tema «Oscuro»"
expected_result:
  - "0 eventos securitypolicyviolation"
  - "ningún <script> ni <style> en línea sin nonce en el HTML crudo"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-010 — El tema oscuro no produce violaciones de la CSP

## Intención

Verifica el requirement «Tema aplicado desde la primera pintura» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado perfil con tema «Oscuro»
Cuando el OWNER recorre Inicio, Transacciones, Reportes y Preferencias con el tema «Oscuro»
Entonces 0 eventos securitypolicyviolation
  Y ningún <script> ni <style> en línea sin nonce en el HTML crudo
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
