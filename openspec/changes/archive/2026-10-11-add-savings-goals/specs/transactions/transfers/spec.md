## ADDED Requirements

### Requirement: Transferencias de aportes y retiros de metas
Una transferencia creada al aportar o retirar fondos de una meta DEBE (MUST) registrarse posteada, con el mismo asiento y las mismas validaciones que cualquier transferencia entre cuentas propias, con origen `goal` y la referencia al movimiento de la meta; DEBE (MUST) poder filtrarse por ese origen en el listado, su detalle DEBE (MUST) indicar la meta a la que está vinculada (también para transferencias vinculadas después a una meta) y anularla o revisarla desde las transacciones DEBE (MUST) permitirse, con el efecto que la meta registra por su cuenta.
Trace: FR-TRANSACTIONS-003, FR-GOALS-002 · Priority: Must

#### Scenario: Transferencia de un aporte
- **CUANDO** el EDITOR aporta 1000.00 BOB de "Banco BOB" a "Ahorro BOB" para "Fondo de emergencia"
- **ENTONCES** la transferencia de 1000.00 BOB aparece en el listado filtrado por origen `goal`
- **Y** su detalle indica que está vinculada a "Fondo de emergencia"
- **Y** no cuenta como ingreso ni como gasto

#### Scenario: Anulación desde las transacciones
- **CUANDO** el EDITOR anula esa transferencia desde las transacciones
- **ENTONCES** la anulación se acepta y el detalle de la transferencia anulada sigue indicando la meta
