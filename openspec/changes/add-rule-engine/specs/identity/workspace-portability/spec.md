## ADDED Requirements

### Requirement: Reglas y origen de la clasificación en el export
El export DEBE (MUST) incluir, y la importación restaurar, las reglas del workspace (activas, inactivas y archivadas) con todas sus versiones, prioridades y disparadores, el origen de la clasificación de cada split (regla y versión) y las marcas de revisión pendientes; tras la importación, las referencias de los splits a reglas y versiones DEBEN (MUST) seguir resolviéndose y la cobertura de clasificación DEBE (MUST) dar el mismo resultado.
Trace: FR-IDENTITY-010, FR-IDENTITY-017, FR-RULES-010 · Priority: Must

#### Scenario: Ida y vuelta con reglas versionadas
- **CUANDO** "W1" tiene 12 reglas (una archivada y "Supermercado" en la versión 3), 148 de 200 transacciones importadas clasificadas por reglas y 3 marcadas para revisión, y el OWNER lo exporta e importa
- **ENTONCES** el workspace nuevo tiene las 12 reglas con sus versiones, prioridades y estados
- **Y** la cobertura del mismo rango vuelve a dar 0.7400 y las 3 marcas siguen pendientes
