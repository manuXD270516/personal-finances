# Spec Delta

## ADDED Requirements

### Requirement: Transacciones de préstamo administradas por el préstamo
Las transacciones de desembolso de préstamo y de pago de préstamo DEBEN (MUST) crearse solo desde el préstamo; DEBEN (MUST) aparecer en el listado, los filtros por tipo y el detalle de transacciones con su desglose (principal, interés, comisiones, seguro e impuestos) y el préstamo de origen; crearlas desde la API de transacciones DEBE (MUST) rechazarse con `VALIDATION_FAILED`, y editar sus montos, cuentas, fecha o moneda, o anularlas fuera del préstamo, DEBE (MUST) rechazarse con `TRANSACTION_MANAGED_EXTERNALLY` indicando el préstamo; editar la descripción, las notas y los tags DEBE (MUST) seguir permitido sin tocar el ledger.
Trace: FR-DEBT-002, FR-DEBT-007, FR-TRANSACTIONS-009 · Priority: Must

#### Scenario: Pago de préstamo en el listado
- **CUANDO** el usuario filtra las transacciones de noviembre de 2026 por tipo pago de préstamo
- **ENTONCES** ve el pago de 2342.02 BOB del 2026-11-15 desde "Banco BOB" con principal 1862.85 BOB e interés 479.17 BOB y el préstamo "Préstamo vehicular"

#### Scenario: Anular un pago desde transacciones
- **CUANDO** el EDITOR anula desde transacciones el pago de 2342.02 BOB del "Préstamo vehicular"
- **ENTONCES** se rechaza con `TRANSACTION_MANAGED_EXTERNALLY` y la transacción sigue vigente

#### Scenario: Agregar una nota al pago
- **CUANDO** el EDITOR agrega la nota "pagado en ventanilla" al pago de 2342.02 BOB
- **ENTONCES** la nota queda registrada y el asiento del pago no cambia
