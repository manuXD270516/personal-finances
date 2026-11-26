## MODIFIED Requirements

### Requirement: Sugerencia de categoría por counterparty
Al elegir una counterparty en un movimiento, el sistema DEBE (MUST) sugerir su categoría por defecto si está activa; si no tiene, la sugerencia por historial de `classification/auto-classification` cuando la haya, y si no la hay, la última categoría activa usada con ella; si no hay ninguna, no sugiere. La sugerencia NO DEBE (MUST NOT) asignarse sin que el usuario la acepte.
Trace: FR-CLASSIFICATION-011, FR-CLASSIFICATION-014 · Priority: Should

#### Scenario: Sugerencia por última categoría usada
- **CUANDO** "Farmacorp" no tiene categoría por defecto, su último gasto de 64.00 BOB fue en "Farmacia" y el usuario la elige en un gasto nuevo
- **ENTONCES** el sistema sugiere la categoría "Farmacia"

#### Scenario: La sugerencia por historial reemplaza a la última usada
- **CUANDO** "Farmacorp" no tiene categoría por defecto, 4 de sus 5 gastos clasificados por el usuario están en "Farmacia", el último está en "Regalos" y el usuario la elige en un gasto nuevo
- **ENTONCES** el sistema sugiere "Farmacia" con confianza 0.8000, no "Regalos"
