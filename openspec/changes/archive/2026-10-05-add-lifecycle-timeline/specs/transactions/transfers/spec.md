# Spec Delta

## Purpose

Hace explícita la revisión de una transferencia como transición trazable: la transferencia completada se publica una sola vez y cada edición financiera publica una transferencia revisada con los asientos involucrados (docs/31 D37).

## ADDED Requirements

### Requirement: Revisión de una transferencia como transición explícita
Editar el monto, la comisión o las cuentas de una transferencia posteada DEBE (MUST) revertir el asiento activo, postear un asiento nuevo con la revisión siguiente y publicar exactamente un hecho "transferencia revisada" con la revisión anterior y la nueva, el asiento revertido, el asiento de reversa y el asiento nuevo; el hecho "transferencia completada" DEBE (MUST) publicarse una sola vez por transferencia, en su primer posteo, y NO DEBE (MUST NOT) volver a publicarse en una edición.
Trace: FR-TRANSACTIONS-036, FR-TRANSACTIONS-018, FR-TRANSACTIONS-008, INV-009, INV-008 · Priority: Must

#### Scenario: Corregir el monto de una transferencia
- **CUANDO** el usuario transfiere 300.00 BOB de "A" (saldo 1000.00 BOB) a "B" (saldo 0.00 BOB) y luego corrige el monto a 250.00 BOB
- **ENTONCES** se publicó un único hecho "transferencia completada" con 300.00 BOB y un único hecho "transferencia revisada" de la revisión 1 a la 2 con 250.00 BOB y los tres asientos
- **Y** los saldos son "A" 750.00 BOB y "B" 250.00 BOB y el patrimonio neto sigue siendo 1000.00 BOB

#### Scenario: Reentrega de la transferencia revisada
- **CUANDO** el hecho "transferencia revisada" de la revisión 2 se entrega dos veces a un consumidor
- **ENTONCES** el consumidor aplica su efecto una sola vez
