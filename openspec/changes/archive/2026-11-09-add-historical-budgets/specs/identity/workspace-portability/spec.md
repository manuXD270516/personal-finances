## ADDED Requirements

### Requirement: Base histórica de las líneas del plan en el export
El export DEBE (MUST) incluir, y la importación restaurar, la base histórica registrada en cada línea de plan aplicada desde una sugerencia (método, N, ajuste, redondeo, periodos con su estado y real, monto sugerido y monto aplicado), y tras la importación la línea DEBE (MUST) mostrar la misma explicación con las referencias a periodos del workspace nuevo.
Trace: FR-IDENTITY-010, FR-IDENTITY-017, FR-PLANNING-021 · Priority: Must

#### Scenario: Ida y vuelta de una línea aplicada desde el historial
- **CUANDO** "W1" tiene "Supermercado" en "2026-11" aplicada con 1480.00 BOB desde el promedio de 6 periodos con "2026-08" atípico, y el OWNER exporta e importa el workspace
- **ENTONCES** la línea del workspace nuevo tiene 1480.00 BOB y la misma base: 6 periodos, "2026-08" atípico y sugerido 1480.00 BOB
