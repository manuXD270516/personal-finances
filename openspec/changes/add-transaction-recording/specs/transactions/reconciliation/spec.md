# Spec Delta

## Purpose

Define el cotejo simple de transacciones contra el extracto en Phase 1: marcar transacciones como confirmadas por el banco (`cleared`), marcarlas como reconciliadas y protegerlas contra cambios accidentales; las sesiones de reconciliación con saldo de extracto llegan en Phase 2.

## ADDED Requirements

### Requirement: Marcar una transacción como cleared
El usuario DEBE (MUST) poder marcar una transacción `posted` como `cleared` y desmarcarla (volver a `posted`) sin que el sistema cree, modifique ni revierta asientos ni cambie los saldos contables.
Trace: FR-TRANSACTIONS-029, FR-TRANSACTIONS-006 · Priority: Must

#### Scenario: Confirmar un gasto contra el extracto
- **CUANDO** el usuario marca como `cleared` un gasto posteado de 150.00 BOB en "Bank A" (saldo 850.00 BOB)
- **ENTONCES** la transacción queda `cleared`, sigue teniendo el mismo único asiento activo y el saldo de "Bank A" sigue en 850.00 BOB

#### Scenario: Marcar como cleared una transacción pendiente
- **CUANDO** el usuario intenta marcar como `cleared` un gasto pendiente de 80.00 BOB
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION`

### Requirement: Marcar transacciones como cleared en lote
El usuario DEBE (MUST) poder marcar o desmarcar como `cleared` una selección de transacciones en una sola operación atómica: si alguna no admite la transición o su versión no coincide, ninguna DEBE (MUST) cambiar; cada transacción cambiada DEBE (MUST) auditarse con un identificador de operación común.
Trace: FR-TRANSACTIONS-029, FR-AUDIT-001 · Priority: Must

#### Scenario: Lote de tres gastos posteados
- **CUANDO** el usuario marca como `cleared` en lote tres gastos posteados de 45.90, 150.00 y 200.00 BOB
- **ENTONCES** los tres quedan `cleared` y existen tres registros de auditoría con el mismo identificador de operación

#### Scenario: Lote con una transacción anulada
- **CUANDO** el lote incluye dos gastos posteados de 45.90 y 150.00 BOB y un gasto anulado de 60.00 BOB
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION` indicando la transacción anulada y ninguna de las tres cambia de estado

### Requirement: Marcar una transacción como reconciliada
El usuario DEBE (MUST) poder marcar una transacción `cleared` como `reconciled` sin cambios en el ledger; solo las transacciones `cleared` pueden pasar a `reconciled`.
Trace: FR-TRANSACTIONS-006 · Priority: Must

#### Scenario: Reconciliar un gasto confirmado
- **CUANDO** el usuario marca como `reconciled` un gasto `cleared` de 150.00 BOB
- **ENTONCES** la transacción queda `reconciled` y el saldo de la cuenta no cambia

#### Scenario: Reconciliar un gasto solo posteado
- **CUANDO** el usuario intenta marcar como `reconciled` un gasto `posted` de 150.00 BOB
- **ENTONCES** se rechaza con el código `INVALID_STATUS_TRANSITION`

### Requirement: Protección de transacciones reconciliadas
Una transacción `reconciled` NO DEBE (MUST NOT) admitir cambios de monto, fecha, cuenta, montos de splits ni anulación (`TRANSACTION_RECONCILED`); los cambios de clasificación y textos descriptivos DEBEN (MUST) seguir permitidos.
Trace: FR-TRANSACTIONS-006, FR-TRANSACTIONS-008 · Priority: Must

#### Scenario: Editar el monto de un gasto reconciliado
- **CUANDO** el usuario intenta cambiar de 150.00 BOB a 155.00 BOB un gasto `reconciled`
- **ENTONCES** se rechaza con el código `TRANSACTION_RECONCILED` y el monto sigue en 150.00 BOB

#### Scenario: Anular un gasto reconciliado
- **CUANDO** el usuario intenta anular un gasto `reconciled` de 150.00 BOB
- **ENTONCES** se rechaza con el código `TRANSACTION_RECONCILED`

#### Scenario: Recategorizar un gasto reconciliado
- **CUANDO** el usuario cambia la categoría del único split de un gasto `reconciled` de 150.00 BOB
- **ENTONCES** el cambio se aplica sin crear asientos

### Requirement: Des-reconciliación explícita y auditada
El usuario DEBE (MUST) poder devolver una transacción `reconciled` a `cleared` solo mediante una acción explícita de des-reconciliación con motivo obligatorio, que DEBE (MUST) quedar auditada.
Trace: FR-TRANSACTIONS-006, FR-AUDIT-001 · Priority: Must

#### Scenario: Des-reconciliar para corregir un monto
- **CUANDO** el usuario des-reconcilia con motivo "monto mal conciliado" un gasto `reconciled` de 150.00 BOB
- **ENTONCES** la transacción queda `cleared` y el historial registra la acción con el actor y el motivo
- **Y** a partir de ese momento puede editar su monto

#### Scenario: Des-reconciliar sin motivo
- **CUANDO** el usuario des-reconcilia un gasto `reconciled` sin indicar motivo
- **ENTONCES** se rechaza con el código `VALIDATION_FAILED` y la transacción sigue `reconciled`
