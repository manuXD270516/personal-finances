---
id: TC-SECURITY-CSP-001
title: "Las páginas de la web salen con una CSP aplicada cuyo nonce llevan todos sus scripts"
spec: security/access-control
related_specs: []
requirement: "Política de seguridad de contenido con nonce por petición en las páginas de la web"
scenario: "Scripts de la página con el nonce de la cabecera"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008"]
invariants: []
priority: critical
type: security
level: e2e
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Stack E2E pfos-e2e con la imagen de producción de finance-web (NODE_ENV=production) y Keycloak real"
  - "Usuario owner de la Minimal Seed con sesión iniciada"
input: {"path":"/es"}
steps:
  - "Abrir el Home y leer la cabecera Content-Security-Policy de la respuesta HTML"
  - "Extraer el nonce de script-src y compararlo con el atributo nonce de cada elemento script del HTML"
expected_result:
  - "La cabecera es Content-Security-Policy (aplicada), no la variante Report-Only"
  - "script-src contiene nonce-<valor> y strict-dynamic, y no contiene unsafe-inline ni unsafe-eval"
  - "Todos los elementos script del HTML llevan el mismo nonce que la cabecera"
  - "La página termina de cargar (data-testid=ready visible) sin violaciones de CSP"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-001 — Las páginas de la web salen con una CSP aplicada cuyo nonce llevan todos sus scripts

## Intención

Requirement «Política de seguridad de contenido con nonce por petición en las páginas de la web» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado un usuario con sesión en el stack E2E con imágenes de producción
Cuando abre el Home
Entonces la respuesta trae Content-Security-Policy con nonce en script-src, sin unsafe-inline ni unsafe-eval
  Y todos los scripts del HTML llevan ese nonce
```

## Notas

- Si next-intl no reenvía las cabeceras de la petición, Next no ve el nonce y este TC falla antes que cualquier otro (design, decisión 2).
- Lo acompaña un test unitario del constructor de la política (directivas de producción frente a desarrollo).
