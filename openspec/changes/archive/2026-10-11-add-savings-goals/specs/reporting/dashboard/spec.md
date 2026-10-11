## MODIFIED Requirements

### Requirement: Preguntas del Home sin datos o no disponibles
Cada pregunta del Home que aún no puede responderse (fase no habilitada o sin datos suficientes) DEBE (MUST) indicarlo explícitamente con la acción que la habilita y NO DEBE (MUST NOT) mostrar un número inventado ni un cero sustituto. Las preguntas "¿Cuánto está comprometido?" (Q4) y "¿Qué pagos vienen?" (Q8) se habilitan en Phase 3 y las responde la capability `reporting/cash-flow-calendar`; solo mientras el workspace no tiene cuentas, definiciones recurrentes activas ni transacciones pendientes de egreso declaran que no hay datos, con la acción de crear una cuenta o un compromiso. La pregunta "¿Voy a cumplir mis metas?" (Q9) se habilita en Phase 4 con las metas de ahorro; solo mientras el workspace no tiene metas activas, pausadas ni alcanzadas declara que no hay datos, con la acción de crear una meta.
Trace: FR-REPORTING-001 · Priority: Must

#### Scenario: Pagos próximos aún no disponibles
- **CUANDO** el usuario abre el Home con cuentas
- **ENTONCES** el widget de disponible para gastar, la única pregunta aún no habilitada, indica que aún no está disponible, con la acción que lo habilita y sin montos
- **Y** las preguntas de comprometido (Q4) y próximos pagos (Q8) no se declaran no disponibles: las responde `reporting/cash-flow-calendar`
- **Y** la pregunta de metas (Q9) no se declara no disponible

#### Scenario: Workspace sin cuentas
- **CUANDO** el workspace no tiene cuentas
- **ENTONCES** la pregunta "¿Cuánto dinero tengo?" indica que no hay cuentas y ofrece crear una, sin mostrar 0.00 BOB
- **Y** las preguntas de comprometido y próximos pagos indican que no hay datos y ofrecen crear la primera cuenta, sin montos

#### Scenario: Workspace sin metas
- **CUANDO** el workspace tiene cuentas pero ninguna meta activa, pausada ni alcanzada
- **ENTONCES** la pregunta "¿Voy a cumplir mis metas?" indica que no hay metas y ofrece crear una, sin mostrar 0 %

## ADDED Requirements

### Requirement: Metas en curso en el Home
El Home DEBE (MUST) responder "¿Voy a cumplir mis metas?" (Q9) con hasta 3 metas `active`, `paused` o `achieved` no archivadas, ordenadas por prioridad y luego por fecha objetivo (las que no tienen fecha al final), cada una con porcentaje completado, saldo acumulado y objetivo, estado de avance o de ciclo de vida, aporte mensual requerido y fecha esperada cuando existan, y la marca de sobre-asignada; DEBE (MUST) indicar cuántas metas más hay y enlazar a la vista de metas, con los mismos cálculos que la capability `goals/savings-goals`.
Trace: FR-REPORTING-001, FR-REPORTING-002, FR-GOALS-003 · Priority: Must

#### Scenario: Cuatro metas activas
- **CUANDO** el workspace tiene "Fondo de emergencia" (prioridad 1, 33.33 %, `behind`), "Viaje a Cusco" (prioridad 2, 45.00 %), "Laptop" (prioridad 2, sin fecha objetivo, 22.22 %) y "Auto" (prioridad 3)
- **ENTONCES** la tarjeta de Q9 muestra "Fondo de emergencia", "Viaje a Cusco" y "Laptop" en ese orden, indica 1 meta más y enlaza a la vista de metas
- **Y** "Fondo de emergencia" muestra 33.33 %, `behind`, el aporte mensual requerido y la fecha esperada

#### Scenario: Meta sobre-asignada en el Home
- **CUANDO** "Laptop" está marcada sobre-asignada
- **ENTONCES** la tarjeta de Q9 muestra "Laptop" con la marca de sobre-asignada

### Requirement: Aportes a metas del mes en el ahorro
Junto al ahorro del mes (Q6), el Home DEBE (MUST) informar los aportes netos a metas del periodo (aportes y reservas menos retiros, liberaciones e inversos con fecha en el periodo, sin contar reasignaciones), por moneda y consolidados en la moneda de reporte con la tasa de la fecha de cada movimiento, sin cambiar el cálculo del ahorro ni de la tasa de ahorro.
Trace: FR-REPORTING-002, FR-GOALS-003 · Priority: Should

#### Scenario: Aportes de octubre
- **CUANDO** en el periodo "2026-10" hubo un aporte real de 1000.00 BOB, una reserva de 2000.00 BOB, una liberación de 500.00 BOB y una reasignación de 1000.00 BOB entre dos metas
- **ENTONCES** los aportes netos a metas del mes son 2500.00 BOB
- **Y** el ahorro y la tasa de ahorro del mes no cambian
