---
id: TC-SECURITY-CSP-006
title: "Las vistas con gráficos y estilos propios se muestran sin violaciones de CSP"
spec: security/access-control
related_specs: ["reporting/cash-flow-calendar"]
requirement: "Estilos bajo la política de la web"
scenario: "Vista con gráfico y estilos propios"
requirement_status: provisional
fr: []
nfr: ["NFR-SEC-008"]
invariants: []
priority: high
type: security
level: e2e
automation_status: not_automated
status: draft
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Stack E2E con la Minimal Seed; usuario owner con sesión"
  - "Pregunta 1 de docs/73 (style-src-attr unsafe-inline) resuelta"
input: {"paths":["/es/flujo-de-caja","/es","/es/reportes"]}
steps:
  - "Abrir el calendario de flujo de caja de 30 días, el Home y la vista de reportes"
  - "Leer style-src y style-src-attr de la cabecera"
  - "Recoger las violaciones de CSP de las tres vistas"
expected_result:
  - "style-src es self más el nonce; style-src-attr permite los atributos en línea"
  - "El HTML no tiene elementos style en línea sin nonce"
  - "Las tres vistas se muestran con sus estilos y gráficos y sin violaciones"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-006 — Las vistas con gráficos y estilos propios se muestran sin violaciones de CSP

## Intención

Requirement «Estilos bajo la política de la web» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado un usuario con sesión
Cuando abre el calendario de flujo de caja, el Home y los reportes
Entonces las vistas se muestran con sus estilos y sin violaciones de la CSP
```

## Notas

- Provisional hasta la pregunta 1 de docs/73: si el owner elige reescribir los estilos, style-src-attr pasa a none y este TC cambia.
- Cubre también el scenario «Elemento de estilo sin nonce» con un test de la spec E2E que inyecta un style sin nonce y espera la violación.
