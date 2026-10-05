# Spec Delta

## Purpose

Agrega la evolución mensual del patrimonio neto (FR-REPORTING-006, Phase 2): una serie de fin de mes valorada con las tasas de cada fecha, honesta cuando falta una tasa, estable para los meses cerrados y con la variación mensual, para responder "¿cómo evolucionó lo que valgo?".

## ADDED Requirements

### Requirement: Serie mensual del patrimonio neto
El sistema DEBERÍA ofrecer, para un rango de meses, el patrimonio neto de cada fin de mes (activos, pasivos y neto en la moneda de reporte) calculado con los saldos de las cuentas incluidas en el patrimonio al último día del mes en la zona horaria del workspace; cuando se ofrece, el mes en curso DEBE (MUST) calcularse a la fecha de hoy y marcarse como parcial.
Trace: FR-REPORTING-006, FR-REPORTING-005 · Priority: Should

#### Scenario: Tres meses de patrimonio
- **CUANDO** al 2026-01-31 "Banco BOB" tiene 2000.00 BOB, "Wallet USDT" 100.000000 USDT y la "Visa" debe 300.00 BOB con USDT/BOB 10.00; al 2026-02-28 tienen 2500.00 BOB, 100.000000 USDT y 0.00 BOB con 10.50; y al 2026-03-31 tienen 2400.00 BOB, 120.000000 USDT y 150.00 BOB con 11.00
- **ENTONCES** la serie de enero a marzo de 2026 informa patrimonio neto 2700.00 BOB, 3550.00 BOB y 3570.00 BOB
- **Y** marzo informa activos 3720.00 BOB y pasivos 150.00 BOB

#### Scenario: Mes en curso parcial
- **CUANDO** hoy es 2026-04-12 y se pide la serie hasta abril de 2026
- **ENTONCES** el punto de abril se calcula al 2026-04-12 y se marca como parcial

### Requirement: Valoración histórica con la tasa de cada fin de mes
Cada punto de la serie DEBE (MUST) valorar los saldos en otras monedas con la tasa vigente a su propia fecha de fin de mes, con el mismo selector de tasa y ventana de vigencia que el patrimonio actual, y NO DEBE (MUST NOT) usar la tasa de hoy para meses pasados; cada punto DEBE (MUST) informar las tasas usadas con su fuente y vigencia.
Trace: FR-REPORTING-006, FR-REPORTING-011, FR-FX-006, INV-012 · Priority: Should

#### Scenario: Revaluación sin movimientos
- **CUANDO** "Wallet USDT" tiene 100.000000 USDT sin movimientos en enero y febrero de 2026, USDT/BOB es 10.00 al 2026-01-31 y 10.50 al 2026-02-28, y hoy es 12.02
- **ENTONCES** la wallet vale 1000.00 BOB en el punto de enero y 1050.00 BOB en el de febrero, y ninguno usa 12.02

### Requirement: Punto incompleto por falta de tasa histórica
Si al fin de un mes una moneda con saldo no tiene tasa vigente hacia la moneda de reporte dentro de la ventana de vigencia, ese punto DEBE (MUST) excluir esos saldos del total, listarlos en su moneda original y marcarse incompleto; NO DEBE (MUST NOT) usar 1:1, una tasa posterior a la fecha ni una fuera de la ventana.
Trace: FR-REPORTING-006, FR-FX-004 · Priority: Should

#### Scenario: Diciembre sin tasa USDT
- **CUANDO** al 2025-12-31 "Banco BOB" tiene 1800.00 BOB y "Wallet USDT" 100.000000 USDT, y la última tasa USDT/BOB anterior es del 2025-12-20 (fuera de la ventana de 7 días)
- **ENTONCES** el punto de diciembre informa 1800.00 BOB marcado incompleto y lista 100.000000 USDT como no valorado

### Requirement: Meses cerrados desde el snapshot de cierre
Para un mes cerrado con snapshot de cierre, el punto DEBERÍA tomar los valores del snapshot vigente (el último tras reaperturas) y marcarse como cerrado; cuando lo hace, cambios posteriores de tasas para esa fecha NO DEBEN (MUST NOT) alterar el valor mostrado.
Trace: FR-REPORTING-006, FR-PLANNING-004, NFR-DATA-006 · Priority: Should

#### Scenario: Tasa registrada después del cierre de marzo
- **CUANDO** marzo de 2026 se cerró con patrimonio neto 3570.00 BOB y después se registra una tasa manual USDT/BOB de 11.20 con fecha 2026-03-31
- **ENTONCES** el punto de marzo sigue informando 3570.00 BOB marcado como cerrado

### Requirement: Cuentas consideradas en cada fecha
Cada punto DEBE (MUST) considerar las cuentas incluidas en el patrimonio con su saldo a esa fecha —incluidas las hoy archivadas o cerradas que tenían saldo en esa fecha— y una cuenta abierta después de la fecha NO DEBE (MUST NOT) aportar al punto.
Trace: FR-REPORTING-006, FR-ACCOUNTS-011 · Priority: Should

#### Scenario: Cuenta archivada con saldo histórico
- **CUANDO** "Caja vieja" tenía 300.00 BOB al 2026-01-31, se vació y archivó en febrero, y "Banco nuevo" se abrió el 2026-02-10 con 500.00 BOB
- **ENTONCES** el punto de enero incluye 300.00 BOB de "Caja vieja" y nada de "Banco nuevo", y el de febrero incluye 500.00 BOB de "Banco nuevo" y nada de "Caja vieja"

### Requirement: Variación mensual del patrimonio
Cada punto de la serie, salvo el primero del rango, DEBERÍA informar la variación absoluta respecto al punto anterior en la moneda de reporte; cuando se informa, si alguno de los dos puntos es incompleto la variación DEBE (MUST) marcarse como no comparable.
Trace: FR-REPORTING-006, FR-REPORTING-018 · Priority: Should

#### Scenario: Variación de febrero y marzo
- **CUANDO** se pide la serie de enero a marzo de 2026 del ejemplo de tres meses
- **ENTONCES** febrero informa una variación de +850.00 BOB y marzo de +20.00 BOB

### Requirement: Rango de la serie de patrimonio
La serie DEBERÍA cubrir por defecto los últimos 12 meses incluido el actual y admitir hasta 120 meses; cuando se ofrece, un rango con meses futuros, invertido o de más de 120 meses DEBE (MUST) rechazarse con `VALIDATION_FAILED`, y una moneda de reporte no habilitada con `CURRENCY_NOT_ENABLED`.
Trace: FR-REPORTING-006 · Priority: Should

#### Scenario: Rango con meses futuros
- **CUANDO** hoy es 2026-04-12 y se pide la serie de enero a junio de 2026
- **ENTONCES** se rechaza con `VALIDATION_FAILED`

#### Scenario: Rango por defecto
- **CUANDO** hoy es 2026-04-12 y se pide la serie sin rango
- **ENTONCES** se obtienen 12 puntos, de mayo de 2025 a abril de 2026
