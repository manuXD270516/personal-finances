## ADDED Requirements

### Requirement: Registro en lote de transacciones importadas
El sistema DEBE (MUST) registrar un lote de hasta 1 000 filas importadas de una misma cuenta como una sola unidad: cada fila nueva DEBE (MUST) crear su transacción posteada con su asiento cuadrado por moneda, su auditoría con origen import y como actor quien aprobó, su recorrido de creación y los mismos eventos que publica el registro individual. La cuenta, la moneda, la escala y los periodos cerrados DEBEN (MUST) validarse para todo el lote con el mismo resultado que fila por fila; si una fila viola una regla del dominio, el lote completo DEBE (MUST) rechazarse con ese código y NO DEBE (MUST NOT) quedar creada ninguna de sus transacciones. Una fila cuya referencia externa ya tiene una transacción no anulada en la cuenta DEBE (MUST) informarse como existente y NO DEBE (MUST NOT) crearse otra, también cuando dos lotes con las mismas referencias se registran a la vez.
Trace: FR-IMPORTS-010, NFR-PERF-007, NFR-DATA-016 · Priority: Must

#### Scenario: Lote de 200 gastos e ingresos
- **CUANDO** "Banco BOB" tiene saldo contable 4000.00 BOB y la EDITOR "Ana" aprueba un import cuyo lote tiene 150 salidas que suman 3750.00 BOB y 50 entradas que suman 5000.00 BOB
- **ENTONCES** existen 200 transacciones posteadas con origen import y 200 asientos, cada uno con suma 0.00 BOB
- **Y** el saldo contable de "Banco BOB" es 5250.00 BOB
- **Y** hay 200 registros de auditoría de creación con origen import y actor "Ana"
- **Y** se publicaron 200 eventos de transacción creada, 200 de transacción posteada y 200 de asiento posteado

#### Scenario: Una fila en periodo cerrado rechaza el lote
- **CUANDO** el periodo "2026-08" está cerrado y un lote de 200 filas trae una fila del 2026-08-15
- **ENTONCES** el lote se rechaza con `PERIOD_CLOSED`
- **Y** no existe ninguna de sus 200 transacciones y el saldo de "Banco BOB" no cambia

#### Scenario: Filas ya registradas en el lote
- **CUANDO** un lote de 200 filas trae 20 cuyas referencias ya tienen una transacción no anulada en "Banco BOB"
- **ENTONCES** se crean 180 transacciones
- **Y** las 20 restantes se informan como existentes con su transacción

#### Scenario: Dos lotes simultáneos con las mismas referencias
- **CUANDO** dos lotes con las mismas 200 referencias de "Banco BOB" se registran al mismo tiempo
- **ENTONCES** cada referencia tiene exactamente una transacción no anulada
- **Y** la suma de creadas entre ambos lotes es 200

### Requirement: Equivalencia entre el registro en lote y el individual
Para los mismos datos de entrada, el registro en lote de filas importadas DEBE (MUST) producir el mismo resultado observable que registrar cada fila como una transacción individual de origen import: mismo tipo, estado, fecha, cuenta, monto, moneda, categoría y descripción; los mismos movimientos del ledger por cuenta y moneda; los mismos campos de auditoría y de recorrido; y los mismos tipos y contenidos de eventos, salvo identificadores e instantes.
Trace: FR-IMPORTS-010, NFR-DATA-016 · Priority: Must

#### Scenario: Tres filas por los dos caminos
- **CUANDO** en dos workspaces idénticos se registran las filas "02/10/2026 PAGO QR CAFÉ 18.00 BOB de salida", "02/10/2026 PAGO QR CAFÉ 18.00 BOB de salida" y "05/10/2026 ABONO SUELDO 8000.00 BOB de entrada", en uno por el registro en lote y en el otro de a una
- **ENTONCES** ambos workspaces tienen 2 gastos de 18.00 BOB "Sin categoría" y 1 ingreso de 8000.00 BOB "Ingreso sin categoría", posteados
- **Y** los movimientos del ledger por cuenta y moneda son iguales y cada asiento suma 0.00 BOB
- **Y** los registros de auditoría, el recorrido y los eventos coinciden salvo identificadores e instantes
