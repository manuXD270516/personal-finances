# Spec Delta

## Purpose

Las transacciones `pending` no tocan el ledger, pero una con fecha en un periodo cerrado nunca podría postearse sin reabrirlo: se rechaza crearlas o editarlas (decisión del owner docs/33 D69, pregunta P-A12 de `add-month-closing`).

## ADDED Requirements

### Requirement: Transacciones pendientes en periodos cerrados
El sistema DEBE (MUST) rechazar con `PERIOD_CLOSED`, sin crear ni modificar nada, el registro de una transacción `pending` con fecha de negocio dentro de un periodo cerrado y la edición de una transacción `pending` que deje o mantenga su fecha de negocio dentro de un periodo cerrado; una `pending` con fecha en un periodo abierto DEBE (MUST) seguir aceptándose.
Trace: FR-PLANNING-005, FR-TRANSACTIONS-001, INV-015 · Priority: Must

#### Scenario: Registrar una pendiente en un mes cerrado
- **CUANDO** "2026-10" está `closed` y el usuario registra un gasto `pending` de 60.00 BOB con fecha 2026-10-29
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y no se crea ninguna transacción
- **Y** el mismo gasto `pending` con fecha 2026-11-02 se acepta

#### Scenario: Mover una pendiente a un mes cerrado
- **CUANDO** "2026-10" está `closed` y el usuario cambia la fecha de un gasto `pending` de 60.00 BOB del 2026-11-02 al 2026-10-30
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el gasto conserva la fecha 2026-11-02
