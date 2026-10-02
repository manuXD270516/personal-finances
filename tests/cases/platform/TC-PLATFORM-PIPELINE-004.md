---
id: TC-PLATFORM-PIPELINE-004
title: Una release con una migración destructiva se pausa hasta recibir aprobación manual
spec: platform/delivery-pipeline
related_specs: []
requirement: Migraciones de base de datos controladas
scenario: Una migración destructiva requiere aprobación
requirement_status: confirmed
fr: []
nfr:
- NFR-DATA-013
- NFR-REL-013
invariants: []
priority: critical
type: platform
level: migration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- ci
- cd
- migrations
error_code: null
preconditions:
- Workflow de despliegue con paso separado de migraciones antes de arrancar la nueva versión
- Release fixture con una migración que elimina una columna
input:
- migration: DROP COLUMN
  expected: pausa hasta aprobación
- migration: ADD COLUMN nullable
  expected: continúa sin aprobación
steps:
- Ejecutar el workflow de despliegue con la release fixture sin aprobación
- Aprobar manualmente y reanudar
- Repetir con una release que solo agrega una columna nullable
expected_result:
- La migración destructiva se clasifica como destructive=true
- El despliegue se detiene antes de ejecutarla, a la espera de aprobación manual
- Tras la aprobación, las migraciones corren como paso separado antes de arrancar la nueva versión
- La migración no destructiva no requiere aprobación
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-PIPELINE-004 — Una release con una migración destructiva se pausa hasta recibir aprobación manual

## Intención

Una migración destructiva en un entorno compartido puede perder datos financieros de forma irreversible.

## Escenario

```gherkin
Dada una release con una migración que elimina una columna
Cuando se despliega a un entorno compartido
Entonces el despliegue se pausa a la espera de aprobación manual antes de ejecutarla
```

## Notas

- Clasificación según docs/23 (marcador pfos:contract / squawk y etiqueta migration:destructive).
