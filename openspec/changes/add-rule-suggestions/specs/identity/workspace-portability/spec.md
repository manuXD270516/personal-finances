## ADDED Requirements

### Requirement: Decisiones sobre sugerencias de reglas en el export
El export DEBE (MUST) incluir, y la importación restaurar, las sugerencias de reglas aceptadas y descartadas (patrón, tipo, categoría, decisión, fecha y regla creada), de modo que tras la importación una sugerencia descartada siga sin mostrarse y una regla creada desde una sugerencia conserve su origen.
Trace: FR-IDENTITY-010, FR-IDENTITY-017, FR-RULES-011 · Priority: Must

#### Scenario: Ida y vuelta con una sugerencia descartada
- **CUANDO** "W1" descartó la sugerencia de "PEDIDOSYA" hacia "Restaurantes" y aceptó la de Tigo como "Recargas Tigo", y el OWNER exporta e importa el workspace
- **ENTONCES** en el workspace nuevo la sugerencia de "PEDIDOSYA" sigue descartada
- **Y** "Recargas Tigo" conserva la sugerencia como origen
