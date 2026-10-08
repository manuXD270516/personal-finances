# Spec Delta

## Purpose

Incorpora los valores de custom fields (FR-CLASSIFICATION-009, FR-TRANSACTIONS-003/026) a los datos de cada transacción, por split, y al listado filtrable de transacciones.

## MODIFIED Requirements

### Requirement: Datos de la transacción
El sistema DEBE (MUST) aceptar, persistir y devolver para cada transacción: fecha de negocio, fecha de posteo bancaria opcional, descripción, contraparte opcional, monto con moneda, cuenta, splits con categoría, tags y valores de custom fields de transacción, notas, estado, origen (`manual`, `import`, `recurring`, `system`) y referencia externa opcional (origen + identificador).
Trace: FR-TRANSACTIONS-002, FR-TRANSACTIONS-003, FR-TRANSACTIONS-026 · Priority: Must

#### Scenario: Ida y vuelta de todos los campos
- **CUANDO** el usuario registra un gasto de 45.90 BOB en "Bank A" con fecha de negocio 2026-03-10, fecha de posteo 2026-03-11, descripción "Compra semanal", contraparte "Supermercado Demo", notas "con factura", un split "Groceries" con tag "familia" y referencia externa ("bank-csv", "TX-998")
- **ENTONCES** al consultarla se devuelven exactamente esos valores, el monto 45.90 BOB y el origen `manual`

#### Scenario: Ida y vuelta con custom fields
- **CUANDO** existen los custom fields de transacción "centro_costo" (`SELECT`) y "factura" (`TEXT`) y el usuario registra un gasto de 45.90 BOB con un split "Groceries" con "centro_costo" = "casa" y "factura" = "F-001234"
- **ENTONCES** al consultarlo el split devuelve exactamente "centro_costo" = "casa" y "factura" = "F-001234"

### Requirement: Listado y filtrado de transacciones
El sistema DEBE (MUST) listar las transacciones del workspace con filtros combinables por rango de fechas, cuentas, tipo, estado, categoría (incluidas subcategorías), tag, contraparte, rango de monto, moneda, origen y valor de custom field (igualdad, y rango para números, decimales y fechas), con orden configurable y paginación por cursor estable.
Trace: FR-TRANSACTIONS-012, FR-CLASSIFICATION-009, NFR-PERF-001 · Priority: Must

#### Scenario: Gastos de marzo en una cuenta y categoría
- **CUANDO** el usuario filtra por cuenta "Bank A", tipo gasto, categoría "Groceries" y fechas del 2026-03-01 al 2026-03-31 con límite 2 y existen 3 gastos que cumplen (45.90 BOB, 150.00 BOB y 200.00 BOB)
- **ENTONCES** la primera página trae 2 transacciones ordenadas por fecha descendente y un cursor
- **Y** la segunda página trae la restante sin repetir ni omitir ninguna

#### Scenario: Filtrar por centro de costo
- **CUANDO** en marzo de 2026 hay gastos de 45.90 BOB y 150.00 BOB con "centro_costo" = "oficina" y uno de 200.00 BOB con "casa", y el usuario filtra por "centro_costo" = "oficina"
- **ENTONCES** obtiene solo los gastos de 45.90 BOB y 150.00 BOB
