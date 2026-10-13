## ADDED Requirements

### Requirement: Vínculo con el catálogo de referencia en el export
El export DEBE (MUST) incluir, y la importación restaurar, el vínculo de cada institución con el catálogo de referencia (país, código y versión) y las tasas por institución registradas con su código; la importación NO DEBE (MUST NOT) consultar el catálogo para cambiar nombres o datos editados por el usuario, ni consultar proveedores para reconstruir tasas.
Trace: FR-IDENTITY-010, FR-IDENTITY-017, FR-ACCOUNTS-012 · Priority: Must

#### Scenario: Ida y vuelta con una institución adoptada y renombrada
- **CUANDO** "W1" adoptó `BAD`, la renombró a "Mi banco", tiene 30 tasas USD/BOB `BANK_SELL` de `BAD` y el OWNER lo exporta e importa
- **ENTONCES** el workspace nuevo tiene "Mi banco" vinculada a `BAD` con la misma versión de catálogo
- **Y** tiene las 30 tasas `BANK_SELL` con el código `BAD`, los mismos valores y vigencias
- **Y** durante la importación no se envía ninguna solicitud a proveedores

#### Scenario: Código ausente en el catálogo de la instalación destino
- **CUANDO** el export contiene una institución vinculada a `BAD` y el catálogo de la instalación destino no tiene `BAD`
- **ENTONCES** la institución se importa con su vínculo y sus datos tal como estaban
- **Y** se muestra como "no figura en el catálogo de esta instalación"
