# commitments/recurrence-engine Specification

## Purpose
Permite registrar lo que el usuario se comprometió a pagar o recibir periódicamente (alquiler, servicios, sueldo, pago de la tarjeta, aportes a ahorro) como definiciones recurrentes cuyas ocurrencias se generan de forma determinista e idempotente en la zona horaria del workspace, se materializan en transacciones según el modo elegido o se resuelven a mano, y alimentan el total comprometido del periodo financiero (Q4) y la lista de próximos pagos (Q8).

## Requirements

### Requirement: Definición recurrente con tipo, cuentas y plantilla
El sistema DEBE (MUST) permitir crear una definición recurrente con nombre, tipo (`INCOME`, `EXPENSE` o `TRANSFER`), cuenta (y cuenta destino si es transferencia), moneda igual a la de la cuenta, tipo de monto, categoría y contraparte opcionales, descripción, regla de recurrencia, fecha de inicio y modo de materialización; DEBE (MUST) rechazar cuentas cerradas o archivadas (`ACCOUNT_CLOSED`), categorías o contrapartes archivadas (`CATEGORY_ARCHIVED`, `COUNTERPARTY_ARCHIVED`), una categoría de tipo distinto al de la definición (`CATEGORY_KIND_MISMATCH`) y una moneda distinta a la de la cuenta (`CURRENCY_MISMATCH`), sin crear nada.
Trace: FR-COMMITMENTS-001 · Priority: Must

#### Scenario: Alquiler mensual creado
- **CUANDO** el EDITOR crea la definición "Alquiler", gasto, cuenta "Banco BOB", 3500.00 BOB fijo, categoría "Vivienda", mensual desde 2026-10-05, modo aprobación pendiente
- **ENTONCES** la definición queda activa en su versión 1 con esos datos
- **Y** sus ocurrencias se generan en el mismo acto hasta el horizonte

#### Scenario: Moneda distinta a la de la cuenta
- **CUANDO** el EDITOR crea un gasto recurrente de 25.00 USD en la cuenta "Banco BOB"
- **ENTONCES** se rechaza con `CURRENCY_MISMATCH` y no se crea la definición

#### Scenario: Categoría archivada
- **CUANDO** el EDITOR crea un gasto recurrente con la categoría archivada "Cable TV"
- **ENTONCES** se rechaza con `CATEGORY_ARCHIVED` y no se crea la definición

### Requirement: Tipos de préstamo y tarjeta reservados
Los tipos `LOAN_PAYMENT` y `CARD_PAYMENT` DEBEN (MUST) existir en el contrato como valores reservados y toda creación o revisión con ellos DEBE (MUST) rechazarse con `RECURRING_KIND_NOT_AVAILABLE` mientras los contextos de deudas no estén habilitados; un pago de tarjeta de crédito recurrente DEBE (MUST) poder registrarse como transferencia de una cuenta activo a la cuenta pasivo de la tarjeta.
Trace: FR-COMMITMENTS-001 · Priority: Must

#### Scenario: Cuota de préstamo aún no disponible
- **CUANDO** el EDITOR crea una definición de tipo `LOAN_PAYMENT` por 1200.00 BOB mensual
- **ENTONCES** se rechaza con `RECURRING_KIND_NOT_AVAILABLE` y no se crea nada

#### Scenario: Pago de tarjeta como transferencia
- **CUANDO** el EDITOR crea una transferencia recurrente de 1450.00 BOB de "Banco BOB" a la tarjeta "Tarjeta X" (pasivo en BOB), mensual el día 6
- **ENTONCES** la definición queda activa con tipo `TRANSFER`

### Requirement: Transferencia recurrente de una sola moneda
Una definición de tipo `TRANSFER` DEBE (MUST) tener cuenta origen y destino distintas y en la misma moneda que el monto; cuentas iguales DEBEN (MUST) rechazarse con `TRANSFER_SAME_ACCOUNT` y monedas distintas con `TRANSFER_CURRENCY_MISMATCH`; materializarla DEBE (MUST) crear una transferencia, no dos transacciones sueltas.
Trace: FR-COMMITMENTS-001 · Priority: Must

#### Scenario: Aporte mensual a ahorro
- **CUANDO** el EDITOR crea una transferencia recurrente de 500.00 BOB de "Banco BOB" a "Ahorro BOB" el día 1 de cada mes
- **ENTONCES** la definición queda activa y al aprobar la ocurrencia del 2026-11-01 se crea una transferencia de 500.00 BOB entre esas cuentas

#### Scenario: Transferencia entre monedas rechazada
- **CUANDO** el EDITOR crea una transferencia recurrente de 100.00 USD de "Banco USD" a "Banco BOB"
- **ENTONCES** se rechaza con `TRANSFER_CURRENCY_MISMATCH` y no se crea la definición

### Requirement: Cadencias predefinidas con intervalo
El sistema DEBE (MUST) soportar las cadencias diaria, semanal, quincenal (cada 2 semanas), semimensual (dos días fijos del mes), mensual, bimestral, trimestral, semestral y anual, cada una con un intervalo N ≥ 1 que multiplica su periodo; la cadencia semimensual DEBE (MUST) indicar exactamente dos días del mes distintos; una regla inválida DEBE (MUST) rechazarse con `RECURRING_INVALID_SCHEDULE`.
Trace: FR-COMMITMENTS-002 · Priority: Must

#### Scenario: Trimestral con intervalo 2
- **CUANDO** se crea una definición trimestral con intervalo 2 desde 2026-01-10
- **ENTONCES** las fechas nominales son 2026-01-10, 2026-07-10 y 2027-01-10

#### Scenario: Quincenal
- **CUANDO** se crea una definición quincenal desde el viernes 2026-10-02
- **ENTONCES** las fechas nominales de octubre y noviembre son 2026-10-02, 2026-10-16, 2026-10-30, 2026-11-13 y 2026-11-27

#### Scenario: Semimensual los días 15 y último
- **CUANDO** se crea una definición semimensual con los días 15 y último del mes desde 2026-10-01
- **ENTONCES** las fechas nominales de octubre y noviembre son 2026-10-15, 2026-10-31, 2026-11-15 y 2026-11-30

#### Scenario: Semimensual con un solo día
- **CUANDO** se crea una definición semimensual con solo el día 15
- **ENTONCES** se rechaza con `RECURRING_INVALID_SCHEDULE`

### Requirement: Cadencia RRULE personalizada
El sistema DEBE (MUST) aceptar una regla personalizada con el subconjunto de RFC 5545 `FREQ` (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`), `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYSETPOS`, `COUNT` y `UNTIL`, evaluada sobre fechas locales del workspace; `COUNT` y `UNTIL` juntos, partes fuera del subconjunto o una regla que no produce ninguna fecha DEBEN (MUST) rechazarse con `INVALID_RRULE`.
Trace: FR-COMMITMENTS-003 · Priority: Should

#### Scenario: Último viernes de cada mes
- **CUANDO** se crea una definición con `FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1` desde 2026-10-01
- **ENTONCES** las fechas nominales de octubre a diciembre son 2026-10-30, 2026-11-27 y 2026-12-25

#### Scenario: Parte no soportada
- **CUANDO** se crea una definición con `FREQ=HOURLY;INTERVAL=2`
- **ENTONCES** se rechaza con `INVALID_RRULE` y no se crea la definición

#### Scenario: COUNT y UNTIL juntos
- **CUANDO** se crea una definición con `FREQ=MONTHLY;COUNT=12;UNTIL=20271231`
- **ENTONCES** se rechaza con `INVALID_RRULE`

### Requirement: Fechas locales en la zona horaria del workspace
Las fechas de las ocurrencias DEBEN (MUST) ser fechas de calendario en la zona horaria del workspace, independientes de la zona del proceso; "hoy" para generar, vencer y materializar DEBE (MUST) calcularse en la zona del workspace.
Trace: FR-COMMITMENTS-003, FR-COMMITMENTS-005 · Priority: Must

#### Scenario: Atraso a medianoche de La Paz
- **CUANDO** el workspace usa America/La_Paz, el proceso corre en UTC y son las 2026-10-21T03:30Z (23:30 del 2026-10-20 en La Paz)
- **ENTONCES** la ocurrencia sin resolver del "Internet" con vencimiento 2026-10-20 todavía no está atrasada
- **Y** a las 2026-10-21T04:05Z (00:05 del 2026-10-21 en La Paz) sí lo está

### Requirement: Tipos de monto
Cada definición DEBE (MUST) declarar un tipo de monto: `FIXED` (monto exacto > 0), `ESTIMATED` (monto esperado > 0 editable al aprobar), `MIN_MAX` (mínimo y máximo con 0 < mínimo ≤ máximo, y las proyecciones usan el máximo) o `VARIABLE` (sin monto, que se ingresa al aprobar); montos ausentes, negativos, con escala mayor a la de la moneda o inconsistentes con el tipo DEBEN (MUST) rechazarse con `RECURRING_INVALID_AMOUNT`.
Trace: FR-COMMITMENTS-004 · Priority: Must

#### Scenario: Gimnasio con rango
- **CUANDO** se crea el gasto recurrente "Gimnasio" `MIN_MAX` de 100.00 a 180.00 BOB
- **ENTONCES** cada ocurrencia esperada informa el rango 100.00–180.00 BOB y 180.00 BOB como monto proyectado

#### Scenario: Rango invertido
- **CUANDO** se crea un gasto `MIN_MAX` de 200.00 a 150.00 BOB
- **ENTONCES** se rechaza con `RECURRING_INVALID_AMOUNT`

#### Scenario: Variable sin monto
- **CUANDO** se crea el gasto recurrente "Compra mayorista" `VARIABLE`
- **ENTONCES** sus ocurrencias no tienen monto esperado

### Requirement: Día 29 a 31 en meses cortos
Una regla mensual o de múltiplos de mes anclada en un día que no existe en un mes DEBE (MUST) producir el último día de ese mes, sin omitir el mes; la fecha nominal resultante DEBE (MUST) ser la clave de la ocurrencia.
Trace: FR-COMMITMENTS-005 · Priority: Must

#### Scenario: Día 31 en febrero y abril
- **CUANDO** se genera una definición mensual el día 31 desde 2027-01-31
- **ENTONCES** las fechas nominales son 2027-01-31, 2027-02-28, 2027-03-31 y 2027-04-30

#### Scenario: Día 29 en año bisiesto
- **CUANDO** se genera una definición anual el día 29 de febrero desde 2028-02-29
- **ENTONCES** las fechas nominales son 2028-02-29, 2029-02-28 y 2030-02-28

### Requirement: Ajuste de fin de semana
Cada definición DEBE (MUST) declarar el ajuste de fin de semana `NONE`, `PREVIOUS` (viernes anterior) o `NEXT` (lunes siguiente); el ajuste DEBE (MUST) cambiar solo la fecha de vencimiento de la ocurrencia y nunca su fecha nominal.
Trace: FR-COMMITMENTS-005 · Priority: Must

#### Scenario: Sábado al viernes anterior
- **CUANDO** el "Internet" mensual del día 10 tiene ajuste `PREVIOUS` y el 2026-10-10 es sábado
- **ENTONCES** la ocurrencia tiene fecha nominal 2026-10-10 y vencimiento 2026-10-09

#### Scenario: Domingo al lunes siguiente
- **CUANDO** el "Sueldo" mensual del día 25 tiene ajuste `NEXT` y el 2026-10-25 es domingo
- **ENTONCES** la ocurrencia tiene fecha nominal 2026-10-25 y vencimiento 2026-10-26

### Requirement: Generación idempotente de ocurrencias
La generación DEBE (MUST) crear a lo sumo una ocurrencia por definición y fecha nominal: re-ejecutarla, ejecutarla con ventanas solapadas o ejecutarla en paralelo DEBE (MUST) producir exactamente el mismo conjunto de ocurrencias, sin duplicados, sin modificar ocurrencias ya existentes y sin publicar hechos repetidos.
Trace: FR-COMMITMENTS-006, INV-013 · Priority: Must

#### Scenario: Re-ejecutar la generación
- **CUANDO** la generación del "Alquiler" mensual desde 2026-10-05 con horizonte hasta 2027-01-07 se ejecuta 5 veces
- **ENTONCES** existen exactamente 4 ocurrencias (2026-10-05, 2026-11-05, 2026-12-05 y 2027-01-05)

#### Scenario: Dos workers en paralelo
- **CUANDO** dos ejecuciones concurrentes generan la misma ventana de la misma definición
- **ENTONCES** cada fecha nominal tiene una sola ocurrencia y se publica un solo hecho de ocurrencias generadas por fecha

### Requirement: Horizonte de generación por el worker
Un proceso del worker DEBE (MUST) extender periódicamente las ocurrencias de cada definición activa hasta "hoy + horizonte" en la zona del workspace, con un horizonte configurable de 90 días por defecto, recordando hasta qué fecha generó; las definiciones pausadas o terminadas NO DEBEN (MUST NOT) generar ocurrencias nuevas.
Trace: FR-COMMITMENTS-006 · Priority: Must

#### Scenario: Ventana deslizante diaria
- **CUANDO** hoy es 2026-10-09, el horizonte es de 90 días y el "Internet" mensual del día 20 tiene ocurrencias hasta 2026-12-20
- **ENTONCES** al pasar al 2026-11-09 el worker genera la ocurrencia del 2027-01-20 (dentro de 2027-02-07)
- **Y** no genera fechas posteriores al 2027-02-07

#### Scenario: Definición pausada no genera
- **CUANDO** la definición "Gimnasio" está pausada y el worker se ejecuta
- **ENTONCES** no se genera ninguna ocurrencia nueva del "Gimnasio"

### Requirement: Rendimiento de la generación
La generación de ocurrencias de un workspace con 60 definiciones activas y horizonte de 90 días DEBE (MUST) completarse en 10 segundos o menos.
Trace: NFR-PERF-009 · Priority: Should

#### Scenario: Sesenta definiciones
- **CUANDO** un workspace tiene 60 definiciones activas (20 diarias, 20 semanales y 20 mensuales) sin ocurrencias y se ejecuta la generación con horizonte de 90 días
- **ENTONCES** se generan todas sus ocurrencias en 10 s o menos

### Requirement: Ocurrencias próximas y atrasadas
Una ocurrencia programada DEBE (MUST) pasar a próxima cuando "hoy" alcanza su fecha de vencimiento menos la anticipación de la definición (0 a 60 días, 3 por defecto) y a atrasada cuando "hoy" supera su fecha de vencimiento sin resolverse; ambas transiciones DEBEN (MUST) ocurrir una sola vez por ocurrencia.
Trace: FR-COMMITMENTS-007 · Priority: Must

#### Scenario: Ocurrencia próxima con anticipación
- **CUANDO** el "Internet" del 2026-10-20 tiene anticipación de 3 días y hoy es 2026-10-17
- **ENTONCES** la ocurrencia pasa a próxima

#### Scenario: Ocurrencia atrasada
- **CUANDO** la ocurrencia del "Internet" del 2026-10-20 sigue sin resolver y hoy es 2026-10-21
- **ENTONCES** la ocurrencia pasa a atrasada

### Requirement: Modo creación automática
En modo creación automática, al llegar la fecha de vencimiento el sistema DEBE (MUST) crear la transacción de la ocurrencia con el estado configurado (`PENDING` o `POSTED`), su monto esperado, fecha de negocio igual a la fecha de vencimiento y origen recurrente, y marcar la ocurrencia como materializada en la misma unidad de trabajo, una sola vez; el modo DEBE (MUST) rechazarse con `RECURRING_MODE_NOT_ALLOWED` para montos `VARIABLE` o `MIN_MAX`.
Trace: FR-COMMITMENTS-007 · Priority: Must

#### Scenario: Internet creado como pendiente
- **CUANDO** el "Internet" de 199.00 BOB fijo está en creación automática con estado `PENDING` y hoy es su vencimiento 2026-10-20
- **ENTONCES** se crea un gasto `PENDING` de 199.00 BOB con fecha 2026-10-20 y origen recurrente
- **Y** la ocurrencia queda materializada con esa transacción

#### Scenario: Worker re-ejecutado no duplica la transacción
- **CUANDO** el worker procesa dos veces la materialización de la ocurrencia del 2026-10-20 del "Internet"
- **ENTONCES** existe una sola transacción para esa ocurrencia

#### Scenario: Variable en creación automática
- **CUANDO** el EDITOR crea un gasto `VARIABLE` en modo creación automática
- **ENTONCES** se rechaza con `RECURRING_MODE_NOT_ALLOWED`

### Requirement: Modo aprobación pendiente
En modo aprobación pendiente, una ocurrencia próxima DEBE (MUST) quedar a la espera de la decisión del usuario sin crear ninguna transacción, y DEBE (MUST) aparecer en la bandeja "por aprobar" hasta que se apruebe, edite, omita o vincule.
Trace: FR-COMMITMENTS-007 · Priority: Must

#### Scenario: Alquiler por aprobar
- **CUANDO** el "Alquiler" de 3500.00 BOB en aprobación pendiente pasa a próxima para el vencimiento del 2026-11-05
- **ENTONCES** no se crea ninguna transacción
- **Y** la ocurrencia del 2026-11-05 aparece en la bandeja "por aprobar"

### Requirement: Modo solo aviso
En modo solo aviso, el sistema DEBE (MUST) avisar cuando la ocurrencia pasa a próxima y NO DEBE (MUST NOT) crear transacciones ni ponerla en la bandeja "por aprobar"; la ocurrencia DEBE (MUST) poder resolverse vinculando la transacción real, aprobándola u omitiéndola.
Trace: FR-COMMITMENTS-007 · Priority: Must

#### Scenario: Débito automático del banco
- **CUANDO** la "Luz" `ESTIMATED` de 150.00 BOB en solo aviso, con vencimiento el 2026-10-25, pasa a próxima
- **ENTONCES** se genera el aviso de pago próximo y no se crea ninguna transacción
- **Y** la ocurrencia no aparece en la bandeja "por aprobar"

### Requirement: Aprobar una ocurrencia crea su transacción
Aprobar una ocurrencia programada, próxima o atrasada DEBE (MUST) crear, por medio del contexto de transacciones y en la misma unidad de trabajo, un ingreso, gasto o transferencia con los datos de la versión vigente de la ocurrencia, el monto indicado al aprobar si el tipo lo admite, la fecha de negocio indicada al aprobar o, por omisión, la menor entre el vencimiento y hoy, origen recurrente y referencia a la ocurrencia, y marcarla materializada; un monto `VARIABLE` sin monto DEBE (MUST) rechazarse con `OCCURRENCE_AMOUNT_REQUIRED`, un monto fuera del rango `MIN_MAX` con `RECURRING_INVALID_AMOUNT` y una ocurrencia ya resuelta con `OCCURRENCE_ALREADY_MATERIALIZED`, sin crear nada.
Trace: FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Aprobar la luz con el monto real
- **CUANDO** el EDITOR aprueba la ocurrencia del 2026-10-25 de la "Luz" `ESTIMATED` de 150.00 BOB indicando 163.40 BOB
- **ENTONCES** se crea un gasto `POSTED` de 163.40 BOB en "Banco BOB" con fecha 2026-10-25, categoría "Servicios" y origen recurrente
- **Y** la ocurrencia queda materializada con esa transacción

#### Scenario: Variable sin monto
- **CUANDO** el EDITOR aprueba una ocurrencia de "Compra mayorista" `VARIABLE` sin indicar monto
- **ENTONCES** se rechaza con `OCCURRENCE_AMOUNT_REQUIRED` y no se crea ninguna transacción

#### Scenario: Pago anticipado del alquiler
- **CUANDO** hoy es 2026-10-30 y el EDITOR aprueba sin indicar fecha la ocurrencia programada del 2026-11-05 del "Alquiler" de 3500.00 BOB
- **ENTONCES** se crea un gasto de 3500.00 BOB con fecha 2026-10-30 y la ocurrencia queda materializada

#### Scenario: Aprobar dos veces
- **CUANDO** el EDITOR aprueba otra vez la ocurrencia ya materializada del 2026-10-25
- **ENTONCES** se rechaza con `OCCURRENCE_ALREADY_MATERIALIZED` y existe una sola transacción

### Requirement: Ocurrencias en periodos cerrados
Materializar una ocurrencia cuya fecha de vencimiento cae en un periodo cerrado DEBE (MUST) rechazarse con `PERIOD_CLOSED` sin crear la transacción ni cambiar la ocurrencia; en creación automática la ocurrencia DEBE (MUST) quedar atrasada para que el usuario la resuelva editando su fecha, vinculándola u omitiéndola.
Trace: FR-COMMITMENTS-008, INV-015 · Priority: Must

#### Scenario: Aprobar en septiembre cerrado
- **CUANDO** el periodo "2026-09" está cerrado y el EDITOR aprueba la ocurrencia atrasada del "Internet" del 2026-09-20
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y la ocurrencia sigue atrasada
- **Y** al editar su fecha a 2026-10-02 y aprobarla se crea el gasto con fecha 2026-10-02

### Requirement: Editar una ocurrencia
El usuario DEBE (MUST) poder cambiar el monto esperado (o rango) y la fecha de vencimiento de una ocurrencia no resuelta sin afectar la definición ni las demás ocurrencias; la fecha nominal DEBE (MUST) conservarse como clave y la ocurrencia editada DEBE (MUST) quedar marcada como modificada.
Trace: FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Alquiler de noviembre con recargo
- **CUANDO** el EDITOR cambia la ocurrencia del 2026-11-05 del "Alquiler" a 3650.00 BOB con vencimiento 2026-11-07
- **ENTONCES** esa ocurrencia espera 3650.00 BOB el 2026-11-07 y conserva la fecha nominal 2026-11-05
- **Y** la ocurrencia del 2026-12-05 sigue esperando 3500.00 BOB

### Requirement: Omitir una ocurrencia
El usuario DEBE (MUST) poder omitir una ocurrencia no resuelta con un motivo opcional; una ocurrencia omitida NO DEBE (MUST NOT) crear transacción, contar como comprometida ni regenerarse.
Trace: FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Gimnasio omitido en vacaciones
- **CUANDO** el EDITOR omite la ocurrencia del 2026-12-28 del "Gimnasio" con el motivo "vacaciones"
- **ENTONCES** la ocurrencia queda omitida, no cuenta en el total comprometido de diciembre
- **Y** re-ejecutar la generación no la vuelve a crear

### Requirement: Marcar pagada vinculando una transacción existente
El usuario DEBE (MUST) poder marcar una ocurrencia no resuelta como pagada vinculándola a una transacción existente no anulada del mismo tipo, cuenta (o par de cuentas) y moneda, que no esté vinculada a otra ocurrencia, sin crear transacciones; el monto puede diferir del esperado; una transacción incompatible DEBE (MUST) rechazarse con `OCCURRENCE_LINK_MISMATCH` y una ya vinculada con `TRANSACTION_ALREADY_LINKED`.
Trace: FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Internet pagado a mano
- **CUANDO** el usuario registró a mano un gasto de 199.00 BOB en "Banco BOB" el 2026-10-19 y vincula con él la ocurrencia del 2026-10-20 del "Internet"
- **ENTONCES** la ocurrencia queda vinculada a esa transacción y no se crea ninguna transacción nueva

#### Scenario: Cuenta distinta
- **CUANDO** el usuario vincula la ocurrencia del "Internet" (cuenta "Banco BOB") con un gasto de 199.00 BOB de la cuenta "Efectivo"
- **ENTONCES** se rechaza con `OCCURRENCE_LINK_MISMATCH` y la ocurrencia no cambia

#### Scenario: Transacción ya vinculada
- **CUANDO** el usuario vincula la ocurrencia de noviembre del "Internet" con el gasto ya vinculado a la de octubre
- **ENTONCES** se rechaza con `TRANSACTION_ALREADY_LINKED`

### Requirement: Liberar la ocurrencia al anular su transacción
Cuando se anula la transacción creada o vinculada por una ocurrencia, la ocurrencia DEBE (MUST) volver a próxima o atrasada según su fecha de vencimiento y la fecha de hoy, sin referencia a la transacción anulada, exactamente una vez aunque el hecho de anulación se entregue varias veces.
Trace: FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Gasto anulado libera la ocurrencia
- **CUANDO** hoy es 2026-10-22 y el usuario anula el gasto de 199.00 BOB vinculado a la ocurrencia del 2026-10-20 del "Internet"
- **ENTONCES** la ocurrencia vuelve a atrasada sin transacción
- **Y** puede aprobarse o vincularse de nuevo

### Requirement: Pausar y reanudar una definición
Pausar una definición activa DEBE (MUST) cancelar sus ocurrencias no resueltas con fecha nominal desde la fecha de pausa y detener la generación; reanudarla DEBE (MUST) reinstaurar las ocurrencias canceladas por la pausa con fecha nominal desde la fecha de reanudación y generar las faltantes hasta el horizonte, sin recrear las del intervalo pausado ni tocar ocurrencias resueltas.
Trace: FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Gimnasio pausado dos meses
- **CUANDO** el "Gimnasio" mensual del día 28 se pausa el 2026-10-10 y se reanuda el 2026-12-01
- **ENTONCES** las ocurrencias del 2026-10-28 y 2026-11-28 quedan canceladas
- **Y** la del 2026-12-28 queda programada y las siguientes se generan hasta el horizonte

### Requirement: Fecha de fin o número máximo de ocurrencias
Una definición DEBE (MUST) admitir una fecha de fin o un número máximo de ocurrencias (no ambos, `RECURRING_INVALID_SCHEDULE`) y una acción de terminar; al terminar o agotarse la serie, la definición DEBE (MUST) quedar terminada, sus ocurrencias no resueltas posteriores a la fecha de fin DEBEN (MUST) cancelarse y no se generan más.
Trace: FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Doce cuotas de un curso
- **CUANDO** se crea el gasto "Curso de inglés" de 400.00 BOB mensual desde 2026-10-15 con máximo 12 ocurrencias
- **ENTONCES** la última ocurrencia es la del 2027-09-15 y no existe ninguna posterior
- **Y** al resolverse o pasar la del 2027-09-15 la definición queda terminada

#### Scenario: Terminar el internet al mudarse
- **CUANDO** el EDITOR termina el "Internet" con fecha de fin 2026-11-30
- **ENTONCES** se cancelan las ocurrencias no resueltas del 2026-12-20 en adelante y la definición queda terminada al pasar el 2026-11-30

### Requirement: Cambiar esta y las siguientes
El usuario DEBE (MUST) poder revisar una definición desde una fecha efectiva creando una versión nueva inmutable; la revisión DEBE (MUST) aplicarse solo a ocurrencias no resueltas con fecha nominal desde la fecha efectiva (reescribiendo su monto, cuentas, categoría y vencimiento, cancelando las que la nueva regla no produce y generando las nuevas) y NO DEBE (MUST NOT) alterar ocurrencias resueltas ni transacciones ya creadas; una fecha efectiva anterior a la última ocurrencia resuelta DEBE (MUST) rechazarse con `RECURRING_REVISION_DATE_INVALID`.
Trace: FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Aumento del alquiler desde enero
- **CUANDO** las ocurrencias de octubre a diciembre del "Alquiler" de 3500.00 BOB están materializadas y el EDITOR lo revisa a 3800.00 BOB desde 2027-01-05
- **ENTONCES** la definición pasa a la versión 2 y la ocurrencia del 2027-01-05 espera 3800.00 BOB con versión 2
- **Y** las ocurrencias y transacciones de octubre a diciembre siguen en 3500.00 BOB con versión 1

#### Scenario: Cambio de día del mes
- **CUANDO** el "Internet" del día 20 se revisa al día 10 desde 2026-11-01 y la ocurrencia del 2026-11-20 no está resuelta
- **ENTONCES** la ocurrencia del 2026-11-20 queda cancelada y se genera la del 2026-11-10

#### Scenario: Fecha efectiva anterior a una resuelta
- **CUANDO** la ocurrencia del 2026-11-05 del "Alquiler" está materializada y el EDITOR revisa desde 2026-10-05
- **ENTONCES** se rechaza con `RECURRING_REVISION_DATE_INVALID` y la definición no cambia

### Requirement: Total comprometido del periodo financiero
El sistema DEBE (MUST) calcular el total comprometido de un periodo financiero como la suma de los montos esperados de las ocurrencias no resueltas de gasto y de transferencia de una cuenta líquida a una cuenta no líquida con vencimiento en el periodo (`MIN_MAX` por su máximo) más las transacciones `PENDING` de egreso con fecha en el periodo, sin contar dos veces una ocurrencia materializada como pendiente; DEBE (MUST) informarlo por moneda y consolidado en la moneda base con la valoración del resumen del Home, la cantidad de ocurrencias sin monto (`VARIABLE`), los ingresos esperados por separado y si el consolidado está completo.
Trace: FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Comprometido de octubre
- **CUANDO** hoy es 2026-10-09 en el periodo "2026-10" (2026-10-01 a 2026-10-31) y quedan sin resolver "Internet" 199.00 BOB (día 20), "Luz" `ESTIMATED` 150.00 BOB (día 25) y "Gimnasio" `MIN_MAX` 100.00–180.00 BOB (día 28), hay un gasto `PENDING` de 250.00 BOB del 2026-10-12 y el "Alquiler" de 3500.00 BOB del 2026-10-05 ya está materializado como `POSTED`
- **ENTONCES** el comprometido en BOB es 779.00 BOB
- **Y** el "Sueldo" esperado de 9000.00 BOB se informa como ingreso esperado y no resta del comprometido

#### Scenario: Comprometido multi-moneda
- **CUANDO** además queda sin resolver "Spotify" 5.99 USD del 2026-10-15 y la tasa de valoración vigente es 6.96 BOB por USD
- **ENTONCES** el comprometido por moneda es 779.00 BOB y 5.99 USD y el consolidado es 820.69 BOB completo

#### Scenario: Sin tasa y con montos variables
- **CUANDO** no hay tasa de valoración para USD y queda sin resolver una ocurrencia `VARIABLE` de "Compra mayorista"
- **ENTONCES** el consolidado es 779.00 BOB marcado incompleto con 5.99 USD sin convertir
- **Y** informa 1 ocurrencia sin monto

### Requirement: Lista de próximos pagos
El sistema DEBE (MUST) listar las ocurrencias no resueltas con vencimiento entre hoy (incluidas las atrasadas) y hoy + N días (7, 30, 60 o 90), ordenadas por vencimiento, con nombre, tipo, monto esperado o rango, cuenta, estado y si requiere aprobación; la lista DEBE (MUST) estar disponible para otros contextos como consulta pública.
Trace: FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Próximos 7 días
- **CUANDO** hoy es 2026-10-17 y se piden los próximos 7 días con la "Luz" atrasada del 2026-10-15, el "Internet" del 2026-10-20 y el "Gimnasio" del 2026-10-28
- **ENTONCES** la lista contiene la "Luz" (atrasada) y el "Internet" en ese orden
- **Y** no contiene el "Gimnasio"

### Requirement: Permisos y auditoría de los compromisos
Consultar definiciones, ocurrencias, el comprometido y los próximos pagos DEBE (MUST) estar permitido a VIEWER, EDITOR y OWNER; crear, revisar, pausar, reanudar, terminar y actuar sobre ocurrencias DEBE (MUST) exigir EDITOR u OWNER (`INSUFFICIENT_ROLE`); cada cambio, incluidos los del worker, DEBE (MUST) auditarse en la misma unidad de trabajo con actor, origen y diff, y los comandos de creación DEBEN (MUST) ser idempotentes con `Idempotency-Key`.
Trace: FR-COMMITMENTS-001, FR-COMMITMENTS-008, FR-AUDIT-001 · Priority: Must

#### Scenario: VIEWER no aprueba
- **CUANDO** un VIEWER aprueba la ocurrencia del 2026-11-05 del "Alquiler"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transacción

#### Scenario: Creación automática auditada como proceso
- **CUANDO** el worker crea el gasto del "Internet" del 2026-10-20 en creación automática
- **ENTONCES** la auditoría registra la materialización con actor de proceso y origen recurrente en la misma transacción que el gasto

### Requirement: Hechos publicados de los compromisos
El sistema DEBE (MUST) publicar, en la misma unidad de trabajo que el cambio, un hecho por lote de ocurrencias generadas por definición y ventana, un hecho por ocurrencia que pasa a próxima, un hecho por ocurrencia materializada o vinculada, un hecho por ocurrencia editada, omitida, liberada o atrasada y un hecho por cambio de estado o revisión de la definición con las ocurrencias afectadas; los montos DEBEN (MUST) viajar como texto decimal con su moneda.
Trace: FR-COMMITMENTS-006, FR-COMMITMENTS-007, FR-COMMITMENTS-008, FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Materialización publicada
- **CUANDO** el EDITOR aprueba la ocurrencia del 2026-11-05 del "Alquiler" por 3500.00 BOB
- **ENTONCES** se publica un único hecho de ocurrencia materializada con la ocurrencia, la transacción creada y el modo "creada"
- **Y** el monto viaja como "3500.00" con moneda BOB
