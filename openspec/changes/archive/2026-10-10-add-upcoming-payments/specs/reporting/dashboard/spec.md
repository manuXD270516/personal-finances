## MODIFIED Requirements

### Requirement: Preguntas del Home sin datos o no disponibles
Cada pregunta del Home que aún no puede responderse (fase no habilitada o sin datos suficientes) DEBE (MUST) indicarlo explícitamente con la acción que la habilita y NO DEBE (MUST NOT) mostrar un número inventado ni un cero sustituto. Las preguntas "¿Cuánto está comprometido?" (Q4) y "¿Qué pagos vienen?" (Q8) se habilitan en Phase 3 y las responde la capability `reporting/cash-flow-calendar`; solo mientras el workspace no tiene cuentas, definiciones recurrentes activas ni transacciones pendientes de egreso declaran que no hay datos, con la acción de crear una cuenta o un compromiso.
Trace: FR-REPORTING-001 · Priority: Must

#### Scenario: Pagos próximos aún no disponibles
- **CUANDO** el usuario abre el Home con cuentas
- **ENTONCES** los widgets de disponible para gastar y de metas, las únicas preguntas aún no habilitadas, indican que aún no están disponibles, con la acción que los habilita y sin montos
- **Y** las preguntas de comprometido (Q4) y próximos pagos (Q8) no se declaran no disponibles: las responde `reporting/cash-flow-calendar`

#### Scenario: Workspace sin cuentas
- **CUANDO** el workspace no tiene cuentas
- **ENTONCES** la pregunta "¿Cuánto dinero tengo?" indica que no hay cuentas y ofrece crear una, sin mostrar 0.00 BOB
- **Y** las preguntas de comprometido y próximos pagos indican que no hay datos y ofrecen crear la primera cuenta, sin montos
