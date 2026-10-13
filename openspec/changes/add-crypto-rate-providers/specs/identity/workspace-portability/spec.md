## ADDED Requirements

### Requirement: Pares de tasa configurados en el export
El export DEBE (MUST) incluir, y la importación restaurar, la lista de pares de tasa automáticos fijada por el workspace o la indicación de que usa la lista por defecto, junto con las tasas `MARKET` registradas; la importación NO DEBE (MUST NOT) consultar providers para reconstruirlas.
Trace: FR-IDENTITY-010, FR-IDENTITY-017, FR-FX-009 · Priority: Must

#### Scenario: Ida y vuelta con pares cripto
- **CUANDO** "W1" fijó la lista USD/BOB, USDT/BOB, BTC/USDT y ETH/USDT, tiene 217 tasas diarias BTC/USDT `MARKET` y el OWNER lo exporta e importa
- **ENTONCES** el workspace nuevo tiene la misma lista de cuatro pares y las 217 tasas BTC/USDT con los mismos valores y vigencias
- **Y** durante la importación no se envía ninguna solicitud a providers

#### Scenario: Workspace con la lista por defecto
- **CUANDO** "W2" nunca fijó su lista y se exporta e importa
- **ENTONCES** el workspace nuevo sigue usando la lista por defecto derivada de sus monedas habilitadas
