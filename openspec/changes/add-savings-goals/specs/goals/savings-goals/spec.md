## ADDED Requirements

### Requirement: Meta de ahorro con tipo, objetivo, fechas y cuentas vinculadas
El sistema DEBE (MUST) permitir crear una meta de ahorro con nombre (de 1 a 120 caracteres, único entre las metas no archivadas del workspace), tipo (`emergency_fund`, `purchase`, `travel`, `education`, `retirement` o `custom`), monto objetivo positivo con su moneda (habilitada en el workspace y con la escala de esa moneda), fecha de inicio (por defecto hoy en la zona del workspace), fecha objetivo opcional posterior a la de inicio, cuentas vinculadas opcionales (cuentas activas de naturaleza activo), prioridad de 1 a 5, icono, color y notas; la meta nace en estado `active`. DEBE (MUST) rechazar sin crear nada: un nombre repetido (`NAME_TAKEN`), un objetivo cero o negativo (`AMOUNT_NOT_POSITIVE`) o con más decimales que su moneda (`AMOUNT_SCALE_EXCEEDED`), una moneda no habilitada (`CURRENCY_NOT_ENABLED`), una fecha objetivo no posterior a la de inicio (`VALIDATION_FAILED`), una cuenta vinculada de naturaleza pasivo (`GOAL_ACCOUNT_NOT_ELIGIBLE`) y una cuenta cerrada o archivada (`ACCOUNT_CLOSED`, `ACCOUNT_ARCHIVED`).
Trace: FR-GOALS-001 · Priority: Must

#### Scenario: Fondo de emergencia creado
- **CUANDO** el EDITOR crea la meta "Fondo de emergencia" de tipo `emergency_fund` por 15000.00 BOB, con inicio 2026-10-01, fecha objetivo 2027-03-31, cuenta vinculada "Ahorro BOB" y prioridad 1
- **ENTONCES** la meta queda `active` con esos datos, saldo acumulado 0.00 BOB y 0.00 % completado

#### Scenario: Fecha objetivo anterior al inicio
- **CUANDO** el EDITOR crea una meta con inicio 2026-10-01 y fecha objetivo 2026-09-30
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea la meta

#### Scenario: Objetivo con más decimales que su moneda
- **CUANDO** el EDITOR crea la meta "Laptop" por 9000.005 BOB
- **ENTONCES** se rechaza con `AMOUNT_SCALE_EXCEEDED` y no se crea la meta

#### Scenario: Tarjeta de crédito como cuenta vinculada
- **CUANDO** el EDITOR crea una meta vinculada a "Tarjeta X", una cuenta de tarjeta de crédito
- **ENTONCES** se rechaza con `GOAL_ACCOUNT_NOT_ELIGIBLE` y no se crea la meta

#### Scenario: Nombre repetido
- **CUANDO** ya existe la meta no archivada "Laptop" y el EDITOR crea otra meta llamada "laptop"
- **ENTONCES** se rechaza con `NAME_TAKEN`

### Requirement: Edición de una meta
El EDITOR u OWNER DEBE (MUST) poder editar nombre, tipo, monto objetivo, fecha objetivo, prioridad, icono, color, notas, tolerancia del estado y cuentas vinculadas de una meta no cerrada ni cancelada, con control de concurrencia; la moneda del objetivo NO DEBE (MUST NOT) cambiar si la meta tiene movimientos (`GOAL_CURRENCY_LOCKED`) y una cuenta vinculada NO DEBE (MUST NOT) desvincularse mientras la meta tenga fondos reales en ella (`GOAL_ACCOUNT_HAS_FUNDS`). Un cambio de objetivo DEBE (MUST) reevaluar el estado: si el saldo acumulado alcanza el nuevo objetivo la meta pasa a `achieved`, y si una meta `achieved` queda por debajo del nuevo objetivo vuelve a `active`.
Trace: FR-GOALS-001 · Priority: Must

#### Scenario: Bajar el objetivo por debajo de lo ahorrado
- **CUANDO** "Fondo de emergencia" tiene saldo acumulado 12500.00 BOB y el EDITOR cambia el objetivo de 15000.00 BOB a 12000.00 BOB
- **ENTONCES** la meta pasa a `achieved` con 104.17 % completado

#### Scenario: Subir el objetivo de una meta alcanzada
- **CUANDO** "Laptop" está `achieved` con 9000.00 BOB de 9000.00 BOB y el EDITOR sube el objetivo a 10000.00 BOB
- **ENTONCES** la meta vuelve a `active` con 90.00 % completado

#### Scenario: Desvincular una cuenta con fondos
- **CUANDO** "Fondo de emergencia" tiene 1000.00 BOB de aportes reales en "Ahorro BOB" y el EDITOR la desvincula
- **ENTONCES** se rechaza con `GOAL_ACCOUNT_HAS_FUNDS` y la cuenta sigue vinculada

#### Scenario: Cambiar la moneda con movimientos
- **CUANDO** "Fondo de emergencia" tiene movimientos y el EDITOR cambia la moneda del objetivo a USD
- **ENTONCES** se rechaza con `GOAL_CURRENCY_LOCKED`

### Requirement: Estados y transiciones de una meta
Una meta DEBE (MUST) tener exactamente uno de los estados `active`, `paused`, `achieved`, `closed` o `cancelled` y cambiar solo por estas transiciones: pausar (`active` → `paused`), reanudar (`paused` → `active`), alcanzar (`active` o `paused` → `achieved`, por el sistema), reabrir (`achieved` → `active`, por el sistema), cerrar (`achieved` → `closed`) y cancelar (`active`, `paused` o `achieved` → `cancelled`, con motivo opcional); cerrar y cancelar DEBEN (MUST) liberar las reservas vigentes de la meta con movimientos explícitos y `closed` y `cancelled` son terminales. Una transición no permitida DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION`; aportar, retirar, reasignar o vincular sobre una meta `closed` o `cancelled` DEBE (MUST) rechazarse con `GOAL_CLOSED`; una meta `paused` DEBE (MUST) seguir aceptando movimientos. Solo una meta `closed` o `cancelled` PUEDE archivarse, lo que la oculta del listado por defecto.
Trace: FR-GOALS-001, FR-GOALS-005 · Priority: Must

#### Scenario: Pausar y reanudar
- **CUANDO** el EDITOR pausa "Fondo de emergencia" y luego la reanuda
- **ENTONCES** la meta pasa a `paused` y vuelve a `active`, y ambas transiciones quedan auditadas

#### Scenario: Cancelar libera las reservas
- **CUANDO** "Laptop" tiene una reserva vigente de 2000.00 BOB sobre "Banco BOB" y el EDITOR la cancela con el motivo "Compra postergada"
- **ENTONCES** la meta queda `cancelled`, se registra una liberación de 2000.00 BOB sobre "Banco BOB" y el disponible para reservar de "Banco BOB" sube 2000.00 BOB

#### Scenario: Aporte a una meta cancelada
- **CUANDO** el EDITOR aporta 100.00 BOB a "Laptop" cancelada
- **ENTONCES** se rechaza con `GOAL_CLOSED` y no se crea ninguna transferencia ni movimiento

#### Scenario: Cerrar una meta activa
- **CUANDO** el EDITOR cierra "Fondo de emergencia" en estado `active`
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION`

#### Scenario: Archivar una meta en curso
- **CUANDO** el EDITOR archiva "Fondo de emergencia" en estado `active`
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y la meta sigue en el listado

### Requirement: Aporte real mediante transferencia a una cuenta vinculada
Un aporte real DEBE (MUST) registrarse como una transferencia posteada desde una cuenta propia hacia una cuenta vinculada a la meta, creada junto con el movimiento de la meta en la misma unidad de trabajo, con fecha, monto en la moneda de las cuentas, cuenta origen, cuenta destino y nota opcional; la transferencia DEBE (MUST) quedar con origen meta y referencia al movimiento. Si la cuenta destino no está vinculada a la meta DEBE (MUST) rechazarse con `GOAL_ACCOUNT_NOT_LINKED`; si la transferencia se rechaza (periodo cerrado, cuenta cerrada o archivada, monedas distintas) NO DEBE (MUST NOT) persistirse ni la transferencia ni el movimiento.
Trace: FR-GOALS-002, FR-TRANSACTIONS-003, INV-018 · Priority: Must

#### Scenario: Aporte de 1000.00 BOB
- **CUANDO** el 2026-10-15 "Banco BOB" tiene 8000.00 BOB y el EDITOR aporta 1000.00 BOB de "Banco BOB" a "Ahorro BOB" para "Fondo de emergencia"
- **ENTONCES** existe una transferencia posteada de 1000.00 BOB de "Banco BOB" a "Ahorro BOB" con origen meta
- **Y** la meta registra un aporte real de 1000.00 BOB que referencia esa transferencia y su saldo acumulado es 1000.00 BOB (6.67 %)
- **Y** "Banco BOB" queda en 7000.00 BOB y "Ahorro BOB" en 1000.00 BOB

#### Scenario: Cuenta destino no vinculada
- **CUANDO** el EDITOR aporta 500.00 BOB de "Banco BOB" a "Efectivo BOB", que no está vinculada a "Fondo de emergencia"
- **ENTONCES** se rechaza con `GOAL_ACCOUNT_NOT_LINKED` y no se crea ninguna transferencia

#### Scenario: Fecha en un periodo cerrado
- **CUANDO** el periodo "2026-09" está cerrado y el EDITOR aporta 500.00 BOB con fecha 2026-09-20
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y no se crea ni la transferencia ni el aporte

### Requirement: Reserva sobre el saldo de una cuenta
Una reserva (earmark) DEBE (MUST) registrarse como un movimiento de la meta sobre una cuenta activa de naturaleza activo, con fecha, monto en la moneda de la cuenta, cuenta y nota opcional, sin crear transacciones ni asientos y sin cambiar el saldo contable de la cuenta; la cuenta NO DEBE (MUST NOT) tener que estar vinculada a la meta.
Trace: FR-GOALS-002, INV-018 · Priority: Must

#### Scenario: Reserva para la laptop
- **CUANDO** "Banco BOB" tiene 7000.00 BOB y el EDITOR reserva 2000.00 BOB de "Banco BOB" para "Laptop" (objetivo 9000.00 BOB)
- **ENTONCES** la meta registra una reserva de 2000.00 BOB sobre "Banco BOB" y su saldo acumulado es 2000.00 BOB (22.22 %)
- **Y** no se crea ninguna transacción ni asiento y el saldo contable de "Banco BOB" sigue en 7000.00 BOB

### Requirement: Reservado y disponible por cuenta
El sistema DEBE (MUST) informar, para cada cuenta con fondos de metas, su saldo contable, el monto reservado por metas (reservas vigentes más aportes reales netos que permanecen en ella, solo de metas `active`, `paused` o `achieved`), el disponible para reservar (saldo contable menos reservado) y el detalle por meta, en la moneda de la cuenta.
Trace: FR-GOALS-004 · Priority: Must

#### Scenario: Banco con dos reservas y ahorro con aportes reales
- **CUANDO** "Banco BOB" tiene saldo contable 7000.00 BOB con reservas de 2000.00 BOB para "Laptop" y 1500.00 BOB para "Fondo de emergencia", y "Ahorro BOB" tiene 1000.00 BOB de aportes reales de "Fondo de emergencia"
- **ENTONCES** "Banco BOB" informa reservado 3500.00 BOB y disponible para reservar 3500.00 BOB
- **Y** "Ahorro BOB" informa saldo 1000.00 BOB, reservado 1000.00 BOB y disponible para reservar 0.00 BOB

### Requirement: Reservas limitadas por el saldo de la cuenta
Una reserva nueva DEBE (MUST) rechazarse con `EARMARK_EXCEEDS_BALANCE` (con saldo, reservado y disponible en el detalle del error) si lo reservado de la cuenta más el monto nuevo supera su saldo contable; un monto igual al disponible DEBE (MUST) aceptarse.
Trace: FR-GOALS-004, INV-018 · Priority: Must

#### Scenario: Reserva mayor que el disponible
- **CUANDO** "Banco BOB" tiene saldo contable 7000.00 BOB y reservado 3500.00 BOB, y el EDITOR reserva 3600.00 BOB para "Laptop"
- **ENTONCES** se rechaza con `EARMARK_EXCEEDS_BALANCE` informando saldo 7000.00 BOB, reservado 3500.00 BOB y disponible 3500.00 BOB

#### Scenario: Reserva exactamente igual al disponible
- **CUANDO** en la misma situación el EDITOR reserva 3500.00 BOB para "Laptop"
- **ENTONCES** la reserva se acepta y el disponible para reservar de "Banco BOB" queda en 0.00 BOB

#### Scenario: Cuenta con fondos reales sin disponible
- **CUANDO** "Ahorro BOB" tiene saldo 1000.00 BOB, todo aporte real de "Fondo de emergencia", y el EDITOR reserva 1.00 BOB de "Ahorro BOB" para "Laptop"
- **ENTONCES** se rechaza con `EARMARK_EXCEEDS_BALANCE`

### Requirement: Meta sobre-asignada cuando el saldo cae
Cuando el saldo contable de una cuenta quede por debajo de lo reservado por metas, el sistema DEBE (MUST) marcar la cuenta y cada meta con fondos en ella como sobre-asignadas, con el faltante (reservado menos saldo), y publicar un único hecho de sobre-asignación por episodio, que termina cuando el saldo vuelve a cubrir lo reservado (la marca se quita); un episodio nuevo DEBE (MUST) publicar un hecho nuevo. Las transacciones pendientes NO DEBEN (MUST NOT) disparar la sobre-asignación porque no cambian el saldo contable.
Trace: FR-GOALS-004, FR-NOTIFY-004 · Priority: Must

#### Scenario: Gasto que deja la cuenta sobre-asignada
- **CUANDO** "Banco BOB" tiene saldo 7000.00 BOB y reservado 7000.00 BOB entre "Laptop" y "Fondo de emergencia", y se postea un gasto de 1200.00 BOB desde "Banco BOB"
- **ENTONCES** "Banco BOB", "Laptop" y "Fondo de emergencia" quedan marcadas sobre-asignadas con faltante 1200.00 BOB
- **Y** se publica un único hecho de sobre-asignación de "Banco BOB"

#### Scenario: Segundo gasto en el mismo episodio
- **CUANDO** luego se postea otro gasto de 100.00 BOB desde "Banco BOB"
- **ENTONCES** el faltante pasa a 1300.00 BOB y no se publica un hecho nuevo

#### Scenario: Ingreso que resuelve el episodio
- **CUANDO** luego se postea un ingreso de 2000.00 BOB en "Banco BOB" (saldo 7700.00 BOB)
- **ENTONCES** se quitan las marcas de sobre-asignación
- **Y** si más adelante el saldo vuelve a caer por debajo de lo reservado se publica un hecho nuevo

#### Scenario: Gasto pendiente
- **CUANDO** "Banco BOB" tiene saldo 7000.00 BOB y reservado 7000.00 BOB, y se registra un gasto pendiente de 500.00 BOB
- **ENTONCES** la cuenta no se marca sobre-asignada

### Requirement: Vincular una transacción existente como aporte real
El EDITOR u OWNER DEBE (MUST) poder vincular a una meta una transferencia posteada ya registrada cuyo destino sea una cuenta vinculada a la meta, que cuenta como aporte real por el monto de la transferencia; DEBE (MUST) rechazarse con `GOAL_TRANSACTION_NOT_ELIGIBLE`, indicando los motivos (`KIND`, `STATUS`, `ACCOUNT`), una transacción que no es transferencia, que no está posteada o que está anulada, o cuyo destino no está vinculado, y con `GOAL_TRANSACTION_ALREADY_LINKED` una transferencia que ya es aporte de cualquier meta.
Trace: FR-GOALS-010, FR-TRANSACTIONS-003, INV-018 · Priority: Must

#### Scenario: Transferencia hecha desde la app del banco
- **CUANDO** el 2026-10-20 el EDITOR registró una transferencia posteada de 500.00 BOB de "Banco BOB" a "Ahorro BOB" y la vincula a "Fondo de emergencia", que tenía 1000.00 BOB
- **ENTONCES** la meta registra un aporte real de 500.00 BOB que referencia esa transferencia y su saldo acumulado es 1500.00 BOB

#### Scenario: Gasto no elegible
- **CUANDO** el EDITOR vincula a "Fondo de emergencia" un gasto de 300.00 BOB
- **ENTONCES** se rechaza con `GOAL_TRANSACTION_NOT_ELIGIBLE` con el motivo `KIND`

#### Scenario: Transferencia pendiente
- **CUANDO** el EDITOR vincula una transferencia pendiente de 500.00 BOB a "Ahorro BOB"
- **ENTONCES** se rechaza con `GOAL_TRANSACTION_NOT_ELIGIBLE` con el motivo `STATUS`

#### Scenario: Transferencia ya vinculada
- **CUANDO** el EDITOR vincula a "Laptop" la transferencia de 500.00 BOB ya vinculada a "Fondo de emergencia"
- **ENTONCES** se rechaza con `GOAL_TRANSACTION_ALREADY_LINKED`

### Requirement: Anulación o revisión de la transacción de un movimiento
Cuando se anule una transacción que respalda un aporte real o un retiro de una meta, el sistema DEBE (MUST) registrar un movimiento inverso por el mismo monto que referencia el movimiento original, sin borrar ni editar el original; cuando se revise financieramente una transferencia que respalda un aporte real, DEBE (MUST) registrar el inverso del aporte anterior y, si el destino revisado sigue vinculado a la meta, un aporte real nuevo por el monto revisado. Cada movimiento derivado DEBE (MUST) auditarse con actor de proceso.
Trace: FR-GOALS-002, FR-GOALS-005, INV-018 · Priority: Must

#### Scenario: Transferencia anulada
- **CUANDO** "Fondo de emergencia" tiene 1500.00 BOB, 500.00 BOB de ellos por la transferencia vinculada del 2026-10-20, y esa transferencia se anula
- **ENTONCES** la meta registra un movimiento inverso de −500.00 BOB que referencia el aporte original y su saldo acumulado es 1000.00 BOB
- **Y** el historial conserva el aporte original y el inverso

#### Scenario: Transferencia revisada a 450.00 BOB
- **CUANDO** en cambio esa transferencia se revisa de 500.00 BOB a 450.00 BOB con el mismo destino
- **ENTONCES** la meta registra el inverso de −500.00 BOB y un aporte real de 450.00 BOB, y su saldo acumulado es 1450.00 BOB

#### Scenario: Destino revisado a una cuenta no vinculada
- **CUANDO** en cambio esa transferencia se revisa para que su destino sea "Efectivo BOB", no vinculada
- **ENTONCES** la meta registra solo el inverso de −500.00 BOB y su saldo acumulado es 1000.00 BOB

### Requirement: Retiro de fondos de una meta
Retirar fondos de una meta DEBE (MUST) registrarse explícitamente como un movimiento negativo sobre una cuenta, con motivo opcional, de una de estas formas: retiro real con una transferencia posteada nueva desde una cuenta vinculada (creada en la misma unidad de trabajo, con origen meta), retiro real vinculando una transferencia o un gasto posteado ya registrado que sale de una cuenta vinculada (por un monto menor o igual al de la transacción), o liberación de una reserva; el monto NO DEBE (MUST NOT) superar los fondos de la meta en esa cuenta para ese tipo de fondo (`GOAL_INSUFFICIENT_FUNDS`).
Trace: FR-GOALS-005 · Priority: Must

#### Scenario: Retiro con transferencia nueva
- **CUANDO** "Fondo de emergencia" tiene 1000.00 BOB de aportes reales en "Ahorro BOB" y el EDITOR retira 400.00 BOB hacia "Banco BOB" con el motivo "Gasto médico"
- **ENTONCES** existe una transferencia posteada de 400.00 BOB de "Ahorro BOB" a "Banco BOB" con origen meta
- **Y** la meta registra un retiro de −400.00 BOB y su saldo acumulado es 600.00 BOB

#### Scenario: Retiro mayor que los fondos
- **CUANDO** el EDITOR retira 1200.00 BOB de "Ahorro BOB" para "Fondo de emergencia", que tiene 1000.00 BOB allí
- **ENTONCES** se rechaza con `GOAL_INSUFFICIENT_FUNDS` y no se crea ninguna transferencia

#### Scenario: Retiro vinculado a un gasto
- **CUANDO** se postea el gasto "Reparación auto" de 300.00 BOB desde "Ahorro BOB" y el EDITOR lo vincula como retiro de 300.00 BOB de "Fondo de emergencia"
- **ENTONCES** la meta registra un retiro de −300.00 BOB que referencia ese gasto, sin crear otra transacción

#### Scenario: Liberación de una reserva
- **CUANDO** "Laptop" tiene 2000.00 BOB reservados en "Banco BOB" y el EDITOR libera 500.00 BOB
- **ENTONCES** la meta registra una liberación de −500.00 BOB, su saldo acumulado es 1500.00 BOB y el disponible para reservar de "Banco BOB" sube 500.00 BOB

### Requirement: Reasignación de fondos entre metas
El EDITOR u OWNER DEBE (MUST) poder reasignar fondos de una meta a otra sobre la misma cuenta y el mismo tipo de fondo, registrando en una sola unidad de trabajo un movimiento negativo en la meta origen y uno positivo en la meta destino ligados entre sí, sin crear transacciones; el monto NO DEBE (MUST NOT) superar los fondos de la meta origen en esa cuenta (`GOAL_INSUFFICIENT_FUNDS`) y, para fondos reales, la cuenta DEBE (MUST) estar vinculada a la meta destino (`GOAL_ACCOUNT_NOT_LINKED`).
Trace: FR-GOALS-005 · Priority: Must

#### Scenario: Reasignar una reserva
- **CUANDO** "Laptop" tiene 1500.00 BOB reservados en "Banco BOB" y el EDITOR reasigna 1000.00 BOB a "Fondo de emergencia"
- **ENTONCES** "Laptop" registra −1000.00 BOB y "Fondo de emergencia" +1000.00 BOB reservados en "Banco BOB", ligados por la misma reasignación
- **Y** lo reservado de "Banco BOB" no cambia

#### Scenario: Fondos reales hacia una meta sin la cuenta vinculada
- **CUANDO** el EDITOR reasigna 300.00 BOB de aportes reales de "Fondo de emergencia" en "Ahorro BOB" a "Laptop", que no tiene "Ahorro BOB" vinculada
- **ENTONCES** se rechaza con `GOAL_ACCOUNT_NOT_LINKED` y ninguna meta cambia

### Requirement: Historial de movimientos inmutable y auditado
Los movimientos de una meta (aporte, reserva, retiro, liberación, inverso y reasignación) NO DEBEN (MUST NOT) editarse ni borrarse: toda corrección DEBE (MUST) hacerse con un movimiento inverso; cada movimiento DEBE (MUST) auditarse en la misma unidad de trabajo con actor, origen y monto, y el saldo acumulado de la meta DEBE (MUST) ser en todo momento la suma de sus movimientos por moneda.
Trace: FR-GOALS-005, INV-018, FR-AUDIT-001 · Priority: Must

#### Scenario: Saldo igual a la suma de movimientos
- **CUANDO** "Fondo de emergencia" tiene los movimientos +1000.00 BOB, +500.00 BOB, −500.00 BOB (inverso) y −400.00 BOB (retiro)
- **ENTONCES** su saldo acumulado es 600.00 BOB

#### Scenario: Intento de editar un movimiento
- **CUANDO** un cliente intenta modificar o borrar el aporte de 1000.00 BOB
- **ENTONCES** la operación no existe (405) y el movimiento no cambia

### Requirement: Saldo acumulado y porcentaje completado
El sistema DEBE (MUST) calcular para cada meta el saldo acumulado en la moneda del objetivo, el restante (objetivo menos acumulado, no negativo) y el porcentaje completado (acumulado ÷ objetivo × 100, que puede superar 100), sin redondeo intermedio y redondeados HALF_EVEN solo al presentar (montos a la escala de la moneda, porcentaje a 2 decimales).
Trace: FR-GOALS-003 · Priority: Must

#### Scenario: Un tercio del objetivo
- **CUANDO** "Fondo de emergencia" tiene 5000.00 BOB de 15000.00 BOB
- **ENTONCES** el porcentaje completado es 33.33 % y el restante 10000.00 BOB

#### Scenario: Meta superada
- **CUANDO** "Fondo de emergencia" tiene 16000.00 BOB de 15000.00 BOB
- **ENTONCES** el porcentaje completado es 106.67 % y el restante 0.00 BOB

### Requirement: Aporte mensual requerido
Para una meta con fecha objetivo, el sistema DEBE (MUST) calcular el aporte mensual requerido como el restante dividido por la cantidad de periodos financieros desde el que contiene hoy (en la zona del workspace) hasta el que contiene la fecha objetivo, ambos incluidos, según el día de inicio del mes financiero; si la fecha objetivo ya pasó y la meta no está alcanzada, el requerido DEBE (MUST) ser todo el restante, marcado como fecha objetivo vencida. Una meta sin fecha objetivo NO DEBE (MUST NOT) informar un requerido (ni 0).
Trace: FR-GOALS-003 · Priority: Must

#### Scenario: Seis periodos hasta marzo
- **CUANDO** hoy es 2026-10-10, el mes financiero empieza el día 1 y "Fondo de emergencia" tiene 5000.00 BOB de 15000.00 BOB con fecha objetivo 2027-03-31
- **ENTONCES** el aporte mensual requerido es 1666.67 BOB (10000.00 BOB en 6 periodos, de "2026-10" a "2027-03")

#### Scenario: Mes financiero que empieza el día 25
- **CUANDO** en la misma situación el mes financiero empieza el día 25
- **ENTONCES** el aporte mensual requerido es 1428.57 BOB (10000.00 BOB en 7 periodos, de "2026-09" a "2027-03")

#### Scenario: Fecha objetivo vencida
- **CUANDO** hoy es 2026-10-10 y una meta de 15000.00 BOB con fecha objetivo 2026-09-30 tiene 14000.00 BOB
- **ENTONCES** el aporte requerido es 1000.00 BOB, marcado como fecha objetivo vencida

#### Scenario: Meta sin fecha objetivo
- **CUANDO** "Laptop" no tiene fecha objetivo
- **ENTONCES** no informa aporte mensual requerido

### Requirement: Fecha esperada de cumplimiento según el ritmo
El sistema DEBE (MUST) calcular el ritmo de una meta como el promedio de sus movimientos netos en los últimos N periodos financieros terminados (N por meta de 1 a 12, por defecto 3), usando los periodos terminados desde el periodo que contiene la fecha de inicio si son menos de N; si no hay ningún periodo terminado, el ritmo DEBE (MUST) ser el aporte mensual planificado si existe. La fecha esperada DEBE (MUST) ser el último día del periodo financiero en que, desde el periodo actual inclusive y al ritmo calculado, se cubre el restante; sin ritmo o con ritmo cero o negativo NO DEBE (MUST NOT) informarse fecha esperada y DEBE (MUST) indicarse "sin ritmo suficiente".
Trace: FR-GOALS-003 · Priority: Must

#### Scenario: Ritmo de 1200.00 BOB al mes
- **CUANDO** hoy es 2026-10-10 con meses que empiezan el día 1, "Fondo de emergencia" tiene un restante de 10000.00 BOB y sus movimientos netos fueron 1200.00 BOB en "2026-07", 900.00 BOB en "2026-08" y 1500.00 BOB en "2026-09"
- **ENTONCES** el ritmo es 1200.00 BOB por periodo y la fecha esperada es 2027-06-30 (9 periodos desde "2026-10")

#### Scenario: Meta nueva con aporte planificado
- **CUANDO** la meta se creó en "2026-10", no tiene periodos terminados y tiene un aporte planificado de 2000.00 BOB por mes con restante 10000.00 BOB
- **ENTONCES** la fecha esperada es 2027-02-28

#### Scenario: Sin ritmo
- **CUANDO** la meta no tiene periodos terminados ni aporte planificado, o sus movimientos netos de los últimos 3 periodos suman −200.00 BOB
- **ENTONCES** no informa fecha esperada e indica "sin ritmo suficiente"

### Requirement: Estado de avance respecto del plan lineal
Para una meta `active` con fecha objetivo, el sistema DEBE (MUST) calcular el estado `behind`, `on-track` o `ahead` comparando el saldo acumulado con el esperado lineal (objetivo × días transcurridos desde el inicio ÷ días entre inicio y fecha objetivo): `on-track` si el desvío relativo está dentro de la tolerancia de la meta (por defecto ±5.00 %, ambos extremos incluidos), `behind` por debajo y `ahead` por encima. Una meta sin fecha objetivo, `paused`, `achieved`, `closed` o `cancelled` NO DEBE (MUST NOT) informar estado de avance, sino su estado de ciclo de vida.
Trace: FR-GOALS-003 · Priority: Must

#### Scenario: Tres estados a mitad de camino
- **CUANDO** la meta "Auto" de 10000.00 BOB va del 2026-01-01 al 2026-04-11 (100 días) y hoy es 2026-02-20 (50 días transcurridos, esperado 5000.00 BOB)
- **ENTONCES** con 4800.00 BOB el estado es `on-track` (−4.00 %), con 4700.00 BOB `behind` (−6.00 %) y con 5300.00 BOB `ahead` (+6.00 %)

#### Scenario: Desvío exactamente en la tolerancia
- **CUANDO** en la misma situación la meta tiene 4750.00 BOB (−5.00 %)
- **ENTONCES** el estado es `on-track`

#### Scenario: Meta pausada
- **CUANDO** "Auto" está `paused`
- **ENTONCES** no informa `behind`, `on-track` ni `ahead`, sino "pausada"

### Requirement: Simulación de escenarios sin persistir
Cualquier miembro DEBE (MUST) poder simular para una meta un aporte mensual, un monto objetivo o una fecha objetivo distintos y obtener el aporte mensual requerido y la fecha esperada resultantes con las mismas reglas de cálculo, usando el aporte simulado como ritmo; la simulación NO DEBE (MUST NOT) persistir cambios en la meta ni auditarse como modificación.
Trace: FR-GOALS-006 · Priority: Should

#### Scenario: Aportar 2000.00 BOB al mes
- **CUANDO** hoy es 2026-10-10, "Fondo de emergencia" tiene restante 10000.00 BOB y fecha objetivo 2027-03-31, y se simula un aporte de 2000.00 BOB por mes
- **ENTONCES** la fecha esperada simulada es 2027-02-28 y el requerido sigue en 1666.67 BOB
- **Y** la meta conserva su versión y sus datos

#### Scenario: Mover la fecha objetivo
- **CUANDO** se simula la fecha objetivo 2027-06-30
- **ENTONCES** el aporte mensual requerido simulado es 1111.11 BOB (10000.00 BOB en 9 periodos)

#### Scenario: Bajar el objetivo
- **CUANDO** "Fondo de emergencia" tiene 8000.00 BOB, ritmo 1200.00 BOB por periodo y se simula un objetivo de 12000.00 BOB
- **ENTONCES** el requerido simulado es 666.67 BOB y la fecha esperada simulada es 2027-01-31

### Requirement: Meta en una moneda distinta a la de sus fondos
Cuando una meta tenga fondos en monedas distintas a la de su objetivo, el saldo acumulado DEBE (MUST) sumarse por moneda y convertirse a la moneda del objetivo con la tasa de valoración vigente al consultar (tipo preferido del par, dentro de la ventana de vigencia de Reporting), indicando la tasa, su fecha y su fuente; los fondos sin tasa vigente DEBEN (MUST) informarse sin convertir y el progreso marcarse incompleto, NUNCA convertirse 1:1. Para el ritmo, cada movimiento en otra moneda DEBE (MUST) valorarse con la tasa de su fecha.
Trace: FR-GOALS-007, FR-FX-006 · Priority: Should

#### Scenario: Viaje en USD con fondos en BOB y USD
- **CUANDO** la meta "Viaje a Cusco" de 2000.00 USD tiene 300.00 USD de aportes reales en "Caja USD" y 7500.00 BOB reservados en "Banco BOB", y la tasa `PARALLEL` USD/BOB vigente de paralelo.bo es 12.50
- **ENTONCES** el saldo acumulado es 900.00 USD (45.00 %) con la tasa 12.50, su fecha y "Fuente: paralelo.bo"

#### Scenario: Sin tasa vigente
- **CUANDO** ninguna tasa USD/BOB está dentro de la ventana de vigencia
- **ENTONCES** el saldo acumulado es 300.00 USD marcado incompleto, con 7500.00 BOB sin convertir

#### Scenario: Ritmo con la tasa de cada fecha
- **CUANDO** en "2026-09" la única reserva de "Viaje a Cusco" fue de 1250.00 BOB el 2026-09-10, con tasa USD/BOB 12.50 a esa fecha
- **ENTONCES** el movimiento neto de "2026-09" para el ritmo es 100.00 USD

### Requirement: Meta alcanzada
Cuando el saldo acumulado de una meta `active` o `paused` alcance o supere su objetivo tras un movimiento, un cambio de objetivo o la reevaluación diaria de metas con fondos en otra moneda, la meta DEBE (MUST) pasar a `achieved` y publicarse un único hecho de meta alcanzada por cada vez que la alcanza; un movimiento posterior que la mantenga alcanzada NO DEBE (MUST NOT) publicarlo otra vez, un retiro, inverso o reasignación que la deje por debajo del objetivo DEBE (MUST) reabrirla y una baja del tipo de cambio NO DEBE (MUST NOT) reabrirla.
Trace: FR-GOALS-008 · Priority: Should

#### Scenario: Laptop alcanzada
- **CUANDO** el 2026-10-20 "Laptop" tiene 8500.00 BOB de 9000.00 BOB y el EDITOR reserva 500.00 BOB más
- **ENTONCES** la meta pasa a `achieved` y se publica un hecho de meta alcanzada con fecha 2026-10-20
- **Y** una reserva posterior de 100.00 BOB no publica otro hecho

#### Scenario: Retiro que reabre
- **CUANDO** "Laptop" está `achieved` con 9100.00 BOB y el EDITOR libera 600.00 BOB
- **ENTONCES** la meta vuelve a `active` con 8500.00 BOB
- **Y** al volver a alcanzar 9000.00 BOB se publica un hecho nuevo de meta alcanzada

#### Scenario: Alcanzada por el tipo de cambio
- **CUANDO** "Viaje a Cusco" tiene 300.00 USD y 21000.00 BOB, la tasa USD/BOB baja de 12.50 a 12.00 y la reevaluación diaria calcula 2050.00 USD
- **ENTONCES** la meta pasa a `achieved`
- **Y** si luego la tasa sube a 12.50 (1980.00 USD) la meta sigue `achieved`

### Requirement: Hecho publicado por cada movimiento de una meta
Por cada movimiento registrado, el sistema DEBE (MUST) publicar en la misma unidad de trabajo un hecho de movimiento de meta con el tipo de fondo y de movimiento, el monto con su moneda, la cuenta, la transacción si la hay, el saldo acumulado y el porcentaje antes y después en la moneda del objetivo y si el progreso está completo; los montos DEBEN (MUST) viajar como texto decimal con su moneda.
Trace: FR-GOALS-008 · Priority: Should

#### Scenario: Aporte de 20 % a 26.67 %
- **CUANDO** "Fondo de emergencia" tiene 3000.00 BOB de 15000.00 BOB y el EDITOR aporta 1000.00 BOB
- **ENTONCES** se publica un hecho de movimiento con aporte real de "1000.00" BOB, acumulado de 3000.00 BOB a 4000.00 BOB y porcentaje de 20.00 % a 26.67 %

### Requirement: Aporte mensual planificado
El EDITOR u OWNER DEBE (MUST) poder definir para una meta un aporte mensual planificado en la moneda del objetivo, con el tipo de fondo (real o reserva) y opcionalmente la cuenta origen, la cuenta destino vinculada y el día del mes; el sistema DEBE (MUST) informar para el periodo financiero actual el planificado, lo aportado neto en el periodo y el pendiente (planificado menos aportado, no negativo). Un plan en otra moneda que la del objetivo DEBE (MUST) rechazarse con `CURRENCY_MISMATCH`; una meta `paused`, `achieved`, `closed` o `cancelled` NO DEBE (MUST NOT) tener pendiente planificado.
Trace: FR-GOALS-009 · Priority: Should

#### Scenario: Pendiente del periodo
- **CUANDO** "Fondo de emergencia" tiene un aporte planificado de 1500.00 BOB por mes y en el periodo "2026-10" lleva aportado neto 1000.00 BOB
- **ENTONCES** el pendiente planificado del periodo es 500.00 BOB

#### Scenario: Aporte por encima de lo planificado
- **CUANDO** en el periodo lleva aportado neto 1800.00 BOB
- **ENTONCES** el pendiente planificado es 0.00 BOB y se indica 300.00 BOB por encima de lo planificado

#### Scenario: Plan en otra moneda
- **CUANDO** el EDITOR define para "Viaje a Cusco" (USD) un aporte planificado de 1000.00 BOB
- **ENTONCES** se rechaza con `CURRENCY_MISMATCH`

### Requirement: Aporte recurrente programado
El EDITOR u OWNER DEBE (MUST) poder programar el aporte mensual planificado real de una meta como un compromiso recurrente de transferencia mensual administrado por la meta, con cuenta origen, cuenta destino vinculada, día del mes y modo de materialización, cuando ambas cuentas y el objetivo estén en la misma moneda (si no, `CURRENCY_MISMATCH`); cada ocurrencia materializada como transferencia posteada DEBE (MUST) registrarse como aporte real de la meta sin otra confirmación. Pausar, reanudar, cerrar o cancelar la meta, o quitar el plan, DEBE (MUST) pausar, reanudar o terminar el compromiso; las acciones de usuario sobre ese compromiso desde los compromisos recurrentes DEBEN (MUST) rechazarse con `RECURRING_MANAGED_EXTERNALLY`, salvo las acciones sobre sus ocurrencias.
Trace: FR-GOALS-009, FR-COMMITMENTS-001 · Priority: Should

#### Scenario: Aporte mensual de 1500.00 BOB programado
- **CUANDO** el EDITOR programa el aporte de 1500.00 BOB de "Fondo de emergencia" de "Banco BOB" a "Ahorro BOB" el día 5 de cada mes en modo aprobación pendiente
- **ENTONCES** existe un compromiso de transferencia mensual de 1500.00 BOB administrado por la meta, con la ocurrencia del 2026-11-05
- **Y** al aprobar esa ocurrencia la meta registra un aporte real de 1500.00 BOB que referencia la transferencia creada

#### Scenario: Ocurrencia omitida
- **CUANDO** el EDITOR omite la ocurrencia del 2026-11-05
- **ENTONCES** la meta no registra aporte y el pendiente planificado de "2026-11" sigue en 1500.00 BOB

#### Scenario: Pausar el compromiso desde los compromisos recurrentes
- **CUANDO** el EDITOR intenta pausar ese compromiso desde los compromisos recurrentes
- **ENTONCES** se rechaza con `RECURRING_MANAGED_EXTERNALLY`
- **Y** pausar "Fondo de emergencia" sí pausa el compromiso

### Requirement: Transferencia a una cuenta vinculada sugerida como aporte
Cuando se postee una transferencia, no creada por una meta ni por un compromiso administrado por una meta, cuyo destino sea una cuenta vinculada a alguna meta `active` o `paused`, el sistema DEBE (MUST) proponer registrarla como aporte real (para esa meta si la cuenta está vinculada a una sola, o sin meta si a varias) y NUNCA DEBE (MUST NOT) registrarla sin la confirmación de un EDITOR u OWNER; una sugerencia descartada NO DEBE (MUST NOT) volver a proponerse y la anulación de la transferencia DEBE (MUST) expirarla.
Trace: FR-GOALS-010, FR-GOALS-002 · Priority: Should

#### Scenario: Sugerencia confirmada
- **CUANDO** se postea una transferencia manual de 700.00 BOB de "Banco BOB" a "Ahorro BOB", vinculada solo a "Fondo de emergencia"
- **ENTONCES** existe una sugerencia de aporte de 700.00 BOB para "Fondo de emergencia"
- **Y** al confirmarla la meta registra un aporte real de 700.00 BOB que referencia la transferencia

#### Scenario: Cuenta vinculada a dos metas
- **CUANDO** "Ahorro BOB" está vinculada a "Fondo de emergencia" y a "Laptop" y se postea una transferencia de 700.00 BOB hacia ella
- **ENTONCES** la sugerencia no indica meta y el EDITOR elige la meta al confirmarla

#### Scenario: Sugerencia descartada
- **CUANDO** el EDITOR descarta la sugerencia de 700.00 BOB
- **ENTONCES** no se registra ningún aporte y esa transferencia no vuelve a sugerirse

### Requirement: Permisos, idempotencia y aislamiento de las metas
Consultar metas, movimientos, reservas por cuenta y simulaciones DEBE (MUST) estar permitido a VIEWER, EDITOR y OWNER; crear, editar, cambiar de estado, aportar, reservar, retirar, reasignar, vincular, planificar y decidir sugerencias DEBE (MUST) exigir EDITOR u OWNER (`INSUFFICIENT_ROLE`); los comandos que crean movimientos DEBEN (MUST) ser idempotentes con `Idempotency-Key` y las ediciones y transiciones DEBEN (MUST) exigir la versión vigente; los datos de un workspace NO DEBEN (MUST NOT) ser visibles desde otro.
Trace: FR-IDENTITY-006, FR-AUDIT-001, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta aportar
- **CUANDO** un VIEWER aporta 100.00 BOB a "Fondo de emergencia"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transferencia ni movimiento

#### Scenario: Aporte reenviado con la misma clave
- **CUANDO** el EDITOR envía dos veces el aporte de 1000.00 BOB con la misma `Idempotency-Key`
- **ENTONCES** existe una sola transferencia y un solo aporte de 1000.00 BOB

#### Scenario: Meta de otro workspace
- **CUANDO** un miembro de "W1" consulta una meta de "W2"
- **ENTONCES** recibe 404 `RESOURCE_NOT_FOUND`

### Requirement: Recorrido de una meta
Cada transición de estado de una meta DEBE (MUST) quedar registrada con actor (usuario o proceso), instante, motivo y versión, y consultarse como recorrido de la máquina de estados de la meta, con los mismos permisos y exportación que el resto de recorridos.
Trace: FR-AUDIT-009, FR-GOALS-001 · Priority: Should

#### Scenario: Recorrido de la laptop
- **CUANDO** "Laptop" se creó, se alcanzó por una reserva, se reabrió por una liberación y se canceló
- **ENTONCES** su recorrido muestra en orden crear, alcanzar (proceso), reabrir (proceso) y cancelar (usuario, con motivo)
