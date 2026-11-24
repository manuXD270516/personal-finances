---
id: TC-SECURITY-CSP-002
title: "El nonce de la CSP cambia en cada petición y tiene al menos 128 bits"
spec: security/access-control
related_specs: []
requirement: "Política de seguridad de contenido con nonce por petición en las páginas de la web"
scenario: "Nonce distinto en cada petición"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008"]
invariants: []
priority: high
type: security
level: unit
automation_status: automated
automated_tests:
  - tests/e2e/specs/content-security-policy.spec.ts
  - apps/web/src/security/csp.test.ts
  - apps/web/src/security/proxy.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Generador de nonce de apps/web, sin red"
input: {"nonces":1000}
steps:
  - "Generar 1000 nonces y medir la longitud decodificada de cada uno"
  - "Cargar dos veces la misma página en el E2E y comparar los nonces de las cabeceras"
expected_result:
  - "Los 1000 nonces son distintos y cada uno decodifica a 16 bytes o más"
  - "Las dos cargas de la página traen nonces distintos"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-002 — El nonce de la CSP cambia en cada petición y tiene al menos 128 bits

## Intención

Requirement «Política de seguridad de contenido con nonce por petición en las páginas de la web» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado el generador de nonce de la web
Cuando se piden 1000 nonces y se carga dos veces la misma página
Entonces todos los nonces son distintos y de al menos 128 bits
```

## Notas

- La parte de las dos cargas se automatiza en la spec E2E de la CSP.
