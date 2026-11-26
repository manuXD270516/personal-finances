---
id: TC-PLATFORM-STACK-011
title: "La subida directa de un documento funciona por HTTPS sin contenido mixto"
spec: platform/local-environment
related_specs: ["documents/attachments"]
requirement: "Stack de E2E servido por HTTPS con una autoridad de prueba efímera"
scenario: "Subida directa de archivos sin contenido mixto"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008", "NFR-USAB-005"]
invariants: []
priority: high
type: platform
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["e2e", "tls", "upload", "csp"]
error_code: null
preconditions:
  - "stack de E2E por HTTPS"
  - "usuario de prueba owner con sesión en W1"
input: {}
steps:
  - "el usuario sube un documento PDF ficticio desde la aplicación"
  - "se juntan los mensajes de consola y las violaciones de CSP de la página"
expected_result:
  - "la petición de subida va a https://localhost con el puerto TLS de archivos y responde con éxito"
  - "no hay bloqueos por contenido mixto ni violaciones de CSP"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-STACK-011 — La subida directa de un documento funciona por HTTPS sin contenido mixto

## Intención

Con un origen https la CSP agrega upgrade-insecure-requests: una URL http mezclada rompería la subida.

## Escenario

```gherkin
Dado stack de E2E por HTTPS
  Y usuario de prueba owner con sesión en W1
Cuando el usuario sube un documento PDF ficticio desde la aplicación
  Y se juntan los mensajes de consola y las violaciones de CSP de la página
Entonces la petición de subida va a https://localhost con el puerto TLS de archivos y responde con éxito
  Y no hay bloqueos por contenido mixto ni violaciones de CSP
```

## Notas

- Change `add-e2e-https` (D516, [docs/84](../../../docs/84-webkit-e2e-questions.md)). Datos ficticios; ningún dato real del owner. La cookie de sesión no cambia.
