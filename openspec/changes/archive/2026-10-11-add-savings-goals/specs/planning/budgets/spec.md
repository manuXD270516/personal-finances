## ADDED Requirements

### Requirement: Aportes planificados a metas en el plan del periodo
El plan mensual de un periodo DEBE (MUST) mostrar una sección de solo lectura "Aportes a metas" con cada meta que tiene aporte mensual planificado y no está pausada, alcanzada, cerrada ni cancelada: planificado, aportado neto en el periodo y pendiente, en la moneda de la meta, y el total pendiente consolidado en la moneda del plan con la valoración de flujos del plan; la sección NO DEBE (MUST NOT) crear líneas de presupuesto ni cambiar el gastado, los umbrales ni el disponible para gastar del plan, y se edita desde la meta.
Trace: FR-GOALS-009, FR-PLANNING-008 · Priority: Should

#### Scenario: Dos metas en el plan de octubre
- **CUANDO** en el periodo "2026-10" "Fondo de emergencia" tiene planificado 1500.00 BOB con 1000.00 BOB aportados y "Laptop" planificado 800.00 BOB con 0.00 BOB aportados
- **ENTONCES** el plan de "2026-10" muestra "Aportes a metas" con pendientes de 500.00 BOB y 800.00 BOB y un total pendiente de 1300.00 BOB
- **Y** el disponible para gastar del plan no cambia

#### Scenario: Meta pausada fuera de la sección
- **CUANDO** "Laptop" está pausada
- **ENTONCES** "Laptop" no aparece en la sección y el total pendiente es 500.00 BOB
