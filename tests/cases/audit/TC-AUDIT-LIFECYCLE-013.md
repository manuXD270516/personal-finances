---
id: TC-AUDIT-LIFECYCLE-013
title: "La pestaña Recorrido destaca el camino recorrido y lista la línea de tiempo"
spec: audit/lifecycle-timeline
related_specs: []
requirement: "Reporte visual del recorrido en la UI"
scenario: "Reporte de un gasto corregido y anulado"
requirement_status: confirmed
fr: ["FR-AUDIT-011"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/lifecycle/lifecycle.test.tsx
  - tests/e2e/specs/lifecycle.spec.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle","ui"]
error_code: null
preconditions:
  - "Gasto de 80.00 BOB registrado pendiente, posteado, corregido a 85.00 BOB y anulado; TZ America/La_Paz"
input: {"page":"detalle de transacción › Recorrido"}
steps:
  - "Abrir la pestaña \"Recorrido\" del gasto"
expected_result:
  - "El diagrama destaca pending, posted y void con postear (1), revisar (2) y anular (3) numeradas"
  - "void aparece como estado actual; cleared y reconciled atenuados"
  - "La línea de tiempo lista registrar, postear, revisar y anular con actor, fecha en hora de La Paz y enlace a la revisión 2"
  - "El diagrama tiene alternativa accesible (aria-describedby a la línea de tiempo)"
created: 2026-10-03
updated: 2026-10-04
---

# TC-AUDIT-LIFECYCLE-013 — La pestaña Recorrido destaca el camino recorrido y lista la línea de tiempo

## Intención

El reporte tipo máquina de estados es la forma en que el owner quiere seguir el camino de un elemento (D37).

## Escenario

```gherkin
Dado un gasto corregido y anulado
Cuando abro su pestaña Recorrido
Entonces veo el camino recorrido destacado en el diagrama
  Y la línea de tiempo con cada transición
```

## Notas

- Numeración del diagrama: solo transiciones (registrar es el punto de entrada).
- Implementación (2026-10-04): en la UI "postear" se rotula "Contabilizar" y "cleared", "Confirmar" (mismos textos que los botones y estados vigentes; una clave de `es.json`). La numeración muestra "1. Contabilizar", "2. Revisar", "3. Anular" en el diagrama y en la línea de tiempo; una arista recorrida varias veces lleva todos sus números ("1, 3"). El E2E también verifica el diagrama vertical a 375 px sin scroll horizontal y el Recorrido de la cuenta.
