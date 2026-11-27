---
id: TC-SECURITY-CSP-003
title: "La subida directa de un documento funciona bajo la CSP y una conexión a otro origen queda bloqueada"
spec: security/access-control
related_specs: ["security/file-upload-security"]
requirement: "Orígenes permitidos por la política de la web"
scenario: "Subida de un documento al hostname de archivos"
requirement_status: confirmed
fr: ["FR-DOCUMENTS-001"]
nfr: ["NFR-SEC-008"]
invariants: []
priority: critical
type: security
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/content-security-policy.spec.ts
  - apps/web/src/security/csp.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Stack E2E con OBJECT_STORAGE_PUBLIC_ENDPOINT configurado también en finance-web"
  - "Usuario owner con sesión y una transacción de gasto de 120.00 BOB en W1"
  - "PDF ficticio generado por la suite (sin datos reales)"
input: {"file":"comprobante.pdf","purpose":"ATTACHMENT"}
steps:
  - "Leer connect-src de la cabecera y comprobar que incluye el origen de OBJECT_STORAGE_PUBLIC_ENDPOINT, sin ruta"
  - "Adjuntar el PDF a la transacción desde la UI"
  - "Desde la página, intentar un fetch a https://example.invalid"
expected_result:
  - "connect-src es self más el origen de subida, y nada más"
  - "La subida termina y el documento aparece adjunto, sin violaciones de CSP"
  - "El fetch a otro origen falla y se registra una violación de connect-src"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-003 — La subida directa de un documento funciona bajo la CSP y una conexión a otro origen queda bloqueada

## Intención

Requirement «Orígenes permitidos por la política de la web» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado el origen de subida configurado en la web
Cuando el usuario adjunta un PDF a una transacción
Entonces connect-src incluye ese origen y la subida termina sin violaciones
  Y una conexión a otro origen queda bloqueada
```

## Notas

- Cubre también el scenario «Origen no autorizado».
