# Spec Delta

## Purpose

Permite modelar las suscripciones del workspace (servicios con precio y ciclo de renovación: streaming, almacenamiento, software, gimnasio…) como compromisos recurrentes con semántica comercial: provider (contraparte), plan, precio y moneda, ciclo, próxima renovación, cuenta o tarjeta de pago, estados `trial`/`active`/`paused`/`cancelled`, fin de trial y cancelación. Cada suscripción se apoya en una definición recurrente del motor de recurrencia (`commitments/recurrence-engine`) que genera sus cargos esperados; la suscripción agrega el historial de precios inmutable con vigencia, la detección de cambios de precio a partir de los cargos reales vinculados, el costo mensualizado y anualizado en moneda base y los recordatorios de renovación y de fin de trial. Las suscripciones en una moneda distinta de la cuenta de pago (USD pagadas con una tarjeta en BOB) y las cobradas en USDT son ciudadanas de primera clase.

## ADDED Requirements

### Requirement: Registrar una suscripción con su definición recurrente
El sistema DEBE (MUST) permitir registrar una suscripción con provider (una contraparte activa del workspace), nombre, plan opcional, precio positivo en una moneda habilitada del workspace, ciclo de facturación (una cadencia del motor de recurrencia con su intervalo), fecha de la primera renovación, cuenta o tarjeta de pago activa, modo de materialización de los cargos y, opcionalmente, categoría y fecha de fin de trial; al registrarla, el sistema DEBE (MUST) crear en la misma operación una definición recurrente de gasto asociada (cuenta de pago, contraparte, categoría, monto y regla del ciclo) y el primer precio del historial con vigencia desde la fecha de la primera renovación. Si la contraparte está archivada, la operación DEBE (MUST) rechazarse con `COUNTERPARTY_ARCHIVED`; si la cuenta de pago está archivada o cerrada, con `ACCOUNT_ARCHIVED` o `ACCOUNT_CLOSED`; si el precio no es positivo, con `AMOUNT_NOT_POSITIVE`; y en todos los casos sin crear la suscripción ni la definición.
Trace: FR-COMMITMENTS-012 · Priority: Must

#### Scenario: Suscripción mensual en USD pagada con una tarjeta en USD
- **CUANDO** el EDITOR registra "Streamly" (contraparte "Streamly"), plan "Premium", 10.99 USD mensual, primera renovación 2026-11-15, pagada con "Visa USD" (`credit_card`, USD), con aprobación manual de cada cargo
- **ENTONCES** existe la suscripción "Streamly" en estado activo con próxima renovación 2026-11-15
- **Y** existe una definición recurrente de gasto mensual asociada de 10.99 USD en "Visa USD" con contraparte "Streamly" que empieza el 2026-11-15
- **Y** el historial de precios tiene una sola entrada: 10.99 USD vigente desde 2026-11-15

#### Scenario: Suscripción cobrada en USDT desde una billetera USDT
- **CUANDO** el EDITOR registra "VPN Pro" por 5.000000 USDT mensual, primera renovación 2026-11-03, pagada con "Wallet USDT" (`crypto_wallet`, USDT)
- **ENTONCES** la definición asociada es de 5.000000 USDT mensual en "Wallet USDT" y el primer precio es 5.000000 USDT vigente desde 2026-11-03

#### Scenario: Contraparte archivada
- **CUANDO** el EDITOR intenta registrar una suscripción con la contraparte archivada "OldTV"
- **ENTONCES** la operación se rechaza con `COUNTERPARTY_ARCHIVED`
- **Y** no se crea ninguna suscripción ni definición recurrente

#### Scenario: Precio cero
- **CUANDO** el EDITOR intenta registrar "MusicBox" con precio 0.00 USD
- **ENTONCES** la operación se rechaza con `AMOUNT_NOT_POSITIVE`

### Requirement: Precio en una moneda distinta de la cuenta de pago
Cuando la moneda del precio difiere de la moneda de la cuenta de pago, el sistema DEBE (MUST) conservar el precio en su moneda original y DEBE (MUST) hacer que cada cargo esperado de la definición asociada esté en la moneda de la cuenta de pago, como monto estimado igual al precio vigente convertido con la tasa de valoración del par (tipo preferido, por defecto la tasa paralela del provider de tasas) vigente al generar el cargo, redondeado HALF_EVEN a la escala de la moneda de la cuenta; si no hay tasa, el cargo esperado DEBE (MUST) quedar sin monto (a ingresar al confirmar) y NO DEBE (MUST NOT) suponerse una tasa 1:1.
Trace: FR-COMMITMENTS-012, FR-COMMITMENTS-004 · Priority: Must

#### Scenario: USD pagado con una tarjeta en BOB
- **CUANDO** el EDITOR registra "Streamly" por 10.99 USD mensual pagada con "Visa BOB" (`credit_card`, BOB) y la tasa paralela USD/BOB vigente al generar el cargo del 2026-11-15 es 9.80
- **ENTONCES** el precio de la suscripción es 10.99 USD
- **Y** el cargo esperado del 2026-11-15 es un monto estimado de 107.70 BOB en "Visa BOB"

#### Scenario: Sin tasa al generar el cargo
- **CUANDO** no hay ninguna tasa USD/BOB dentro de la ventana de vigencia al generar el cargo del 2026-12-15
- **ENTONCES** el cargo esperado del 2026-12-15 queda sin monto y pide el monto real al confirmarlo
- **Y** no se registra un cargo esperado de 10.99 BOB

### Requirement: Listado y detalle de suscripciones
Todo miembro del workspace DEBE (MUST) poder listar las suscripciones filtrando por estado, provider y cuenta de pago, y ver el detalle de cada una con su provider, plan, precio vigente y su moneda, ciclo, próxima renovación, cuenta de pago, estado, fin de trial, fecha de cancelación, historial de precios y la propuesta de precio pendiente si existe; por defecto el listado DEBE (MUST) excluir las canceladas.
Trace: FR-COMMITMENTS-012 · Priority: Must

#### Scenario: Listado por defecto sin canceladas
- **CUANDO** el workspace tiene "Streamly" activa, "CloudDrive" en trial, "MusicBox" pausada y "OldTV" cancelada y el VIEWER lista las suscripciones
- **ENTONCES** ve "Streamly", "CloudDrive" y "MusicBox" con su estado
- **Y** "OldTV" solo aparece al filtrar por estado cancelada

### Requirement: Editar una suscripción sin alterar el pasado
El EDITOR DEBE (MUST) poder cambiar el nombre, el plan, la categoría, el modo de materialización, los ajustes de recordatorio y la tolerancia de cambio de precio de una suscripción no cancelada, y DEBE (MUST) poder cambiar su cuenta de pago o su ciclo de facturación con una fecha de efecto; esos dos cambios DEBEN (MUST) aplicarse solo a los cargos con fecha igual o posterior a la fecha de efecto y NO DEBEN (MUST NOT) modificar cargos ya materializados ni sus transacciones. Editar una suscripción cancelada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION`.
Trace: FR-COMMITMENTS-012, FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Cambio de tarjeta desde la próxima renovación
- **CUANDO** "Streamly" se pagó con "Visa USD" el 2026-10-15 (transacción de 10.99 USD ya registrada) y el EDITOR cambia la cuenta de pago a "Visa BOB" con efecto 2026-11-15
- **ENTONCES** el cargo esperado del 2026-11-15 es en "Visa BOB"
- **Y** la transacción del 2026-10-15 sigue en "Visa USD" por 10.99 USD

#### Scenario: Suscripción cancelada no editable
- **CUANDO** el EDITOR intenta cambiar el plan de "OldTV", que está cancelada
- **ENTONCES** la operación se rechaza con `INVALID_STATUS_TRANSITION`

### Requirement: Estados y transiciones de la suscripción
Una suscripción DEBE (MUST) estar en uno de los estados `trial`, `active`, `paused` o `cancelled` y DEBE (MUST) admitir solo estas transiciones: alta en `trial` (con fin de trial) o en `active`; `trial` → `active` al llegar el fin de trial; `trial` → `cancelled`; `active` → `paused`; `paused` → `active`; `active` → `cancelled`; `paused` → `cancelled`. `cancelled` DEBE (MUST) ser terminal. Cualquier otra transición DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION` sin cambiar el estado.
Trace: FR-COMMITMENTS-012 · Priority: Must

#### Scenario: Pausar una suscripción en trial
- **CUANDO** el EDITOR intenta pausar "CloudDrive", que está en trial
- **ENTONCES** la operación se rechaza con `INVALID_STATUS_TRANSITION` y "CloudDrive" sigue en trial

#### Scenario: Reanudar una cancelada
- **CUANDO** el EDITOR intenta reanudar "OldTV", que está cancelada
- **ENTONCES** la operación se rechaza con `INVALID_STATUS_TRANSITION`

### Requirement: Período de prueba y su fin
Una suscripción registrada con fecha de fin de trial DEBE (MUST) empezar en `trial` y su primera renovación DEBE (MUST) ser igual o posterior al fin de trial (si no, `VALIDATION_FAILED`); al llegar el fin de trial en la zona horaria del workspace, el sistema DEBE (MUST) pasarla automáticamente a `active`, una sola vez. Cancelar una suscripción en `trial` DEBE (MUST) finalizar su definición sin que quede ningún cargo esperado pendiente ni exista transacción.
Trace: FR-COMMITMENTS-012 · Priority: Must

#### Scenario: Trial que termina
- **CUANDO** "CloudDrive" (99.99 USD anual) se registró el 2026-10-20 con fin de trial 2026-11-20 y primera renovación 2026-11-20, y el reloj llega al 2026-11-20 00:05 en America/La_Paz
- **ENTONCES** "CloudDrive" está en `active`
- **Y** su próxima renovación es 2026-11-20 por 99.99 USD

#### Scenario: Cancelación durante el trial
- **CUANDO** el EDITOR cancela "CloudDrive" el 2026-11-10, antes del fin de trial
- **ENTONCES** "CloudDrive" queda `cancelled` con fecha de cancelación 2026-11-10
- **Y** "CloudDrive" no tiene ningún cargo esperado pendiente ni transacción

#### Scenario: Primera renovación antes del fin de trial
- **CUANDO** el EDITOR registra una suscripción con fin de trial 2026-11-20 y primera renovación 2026-11-01
- **ENTONCES** la operación se rechaza con `VALIDATION_FAILED`

### Requirement: Próxima renovación derivada del ciclo
La próxima renovación de una suscripción `trial` o `active` DEBE (MUST) ser la fecha del siguiente cargo de su definición recurrente con fecha igual o posterior a hoy en la zona horaria del workspace que no esté resuelto (pagado, vinculado a una transacción u omitido) ni cancelado, con las reglas de fecha del motor de recurrencia (día 29–31 en meses cortos ⇒ último día del mes); una suscripción `paused` o `cancelled` NO DEBE (MUST NOT) tener próxima renovación.
Trace: FR-COMMITMENTS-012, FR-COMMITMENTS-005 · Priority: Must

#### Scenario: Renovación pagada
- **CUANDO** "Streamly" renueva el día 15 de cada mes, hoy es 2026-11-15 y el cargo del 2026-11-15 ya está materializado
- **ENTONCES** la próxima renovación es 2026-12-15

#### Scenario: Renovación omitida
- **CUANDO** el usuario omite el cargo del 2026-12-15 de "Streamly" y hoy es 2026-12-01
- **ENTONCES** la próxima renovación es 2027-01-15

#### Scenario: Día 31 en un mes corto
- **CUANDO** "Gimnasio Centro" renueva el día 31 de cada mes y hoy es 2027-02-10
- **ENTONCES** la próxima renovación es 2027-02-28

### Requirement: Pausar y reanudar una suscripción
Pausar una suscripción `active` DEBE (MUST) pausar su definición recurrente, de modo que no queden cargos esperados pendientes mientras esté pausada; reanudarla DEBE (MUST) reanudar la definición y recalcular la próxima renovación desde la fecha de reanudación, sin generar cargos para las fechas transcurridas durante la pausa. Pausar o reanudar NO DEBE (MUST NOT) modificar cargos ya materializados ni sus transacciones.
Trace: FR-COMMITMENTS-012, FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Pausa de dos meses
- **CUANDO** "MusicBox" (9.99 USD el día 5 de cada mes) se pausa el 2026-11-01 y se reanuda el 2027-01-10
- **ENTONCES** "MusicBox" no tiene cargos esperados pendientes para 2026-11-05, 2026-12-05 ni 2027-01-05
- **Y** la próxima renovación es 2027-02-05

### Requirement: Historial de precios inmutable con vigencia
Cada suscripción DEBE (MUST) mantener un historial de precios en el que cada entrada tiene un monto, una moneda y una fecha de vigencia (`effectiveFrom`); el precio vigente en una fecha DEBE (MUST) ser el de la entrada no reemplazada con la mayor vigencia menor o igual a esa fecha. Las entradas NO DEBEN (MUST NOT) modificarse ni borrarse; todas las entradas de una suscripción DEBEN (MUST) estar en la moneda del precio de la suscripción.
Trace: FR-COMMITMENTS-013 · Priority: Must

#### Scenario: Precio vigente por fecha
- **CUANDO** el historial de "Streamly" tiene 10.99 USD desde 2026-11-15 y 12.99 USD desde 2027-03-15
- **ENTONCES** el precio vigente el 2027-02-28 es 10.99 USD y el 2027-03-15 es 12.99 USD

#### Scenario: Intento de editar una entrada
- **CUANDO** alguien intenta cambiar el monto de la entrada de 10.99 USD desde 2026-11-15
- **ENTONCES** la operación se rechaza y el historial no cambia

### Requirement: Cambio de precio manual aplicado a renovaciones futuras
El EDITOR DEBE (MUST) poder registrar un precio nuevo con su fecha de vigencia, que DEBE (MUST) ser posterior a la vigencia de la última entrada no reemplazada (si no, `SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL`); el sistema DEBE (MUST) agregar la entrada al historial, actualizar el monto de la definición recurrente para los cargos con fecha igual o posterior a la vigencia sin alterar cargos materializados ni transacciones, y publicar el hecho `commitments.SubscriptionPriceChanged.v1` con origen manual, el precio anterior, el nuevo y la variación porcentual.
Trace: FR-COMMITMENTS-013, FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Aumento anunciado por el provider
- **CUANDO** el historial de "Streamly" tiene 10.99 USD desde 2026-11-15, el cargo del 2026-11-15 ya se registró por 10.99 USD y el EDITOR registra 12.99 USD desde 2027-03-15
- **ENTONCES** el historial tiene 10.99 USD desde 2026-11-15 y 12.99 USD desde 2027-03-15
- **Y** el cargo esperado del 2027-03-15 es de 12.99 USD y la transacción del 2026-11-15 sigue en 10.99 USD
- **Y** se publica el hecho de cambio de precio de "Streamly" de 10.99 USD a 12.99 USD desde 2027-03-15 con variación "+18.20"

#### Scenario: Vigencia anterior a la última
- **CUANDO** la última entrada es 12.99 USD desde 2027-03-15 y el EDITOR registra 11.99 USD desde 2027-01-15
- **ENTONCES** la operación se rechaza con `SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL`

### Requirement: Cancelar una suscripción sin afectar el pasado
Cancelar una suscripción `trial`, `active` o `paused` con fecha efectiva hoy o anterior DEBE (MUST) dejarla en `cancelled` con su fecha de cancelación y motivo opcional, y DEBE (MUST) finalizar su definición recurrente de modo que ningún cargo esperado con fecha igual o posterior a la fecha de cancelación quede pendiente (los no resueltos quedan cancelados); las transacciones ya registradas, los cargos materializados y el historial de precios NO DEBEN (MUST NOT) modificarse. La operación DEBE (MUST) publicar `commitments.SubscriptionCancelled.v1`.
Trace: FR-COMMITMENTS-017 · Priority: Must

#### Scenario: Cancelación con historia
- **CUANDO** "Streamly" tiene transacciones de 10.99 USD del 2026-09-15 y 2026-10-15 y un cargo esperado no resuelto del 2026-11-15, y el EDITOR la cancela el 2026-11-02
- **ENTONCES** "Streamly" queda `cancelled` con fecha de cancelación 2026-11-02 y sin próxima renovación
- **Y** el cargo esperado del 2026-11-15 queda cancelado y la definición queda finalizada
- **Y** las transacciones del 2026-09-15 y 2026-10-15 siguen registradas por 10.99 USD cada una

#### Scenario: Cancelar dos veces
- **CUANDO** el EDITOR intenta cancelar "Streamly" otra vez
- **ENTONCES** la operación se rechaza con `INVALID_STATUS_TRANSITION`

### Requirement: Permisos, auditoría y aislamiento de suscripciones
Todo miembro activo DEBE (MUST) poder leer las suscripciones de su workspace; solo OWNER y EDITOR DEBEN (MUST) poder crearlas, editarlas, cambiar su precio, decidir propuestas, pausarlas, reanudarlas o cancelarlas (un VIEWER recibe `INSUFFICIENT_ROLE`); cada uno de esos cambios DEBE (MUST) quedar en el registro de auditoría con actor, instante y diff en la misma operación. Una suscripción de otro workspace DEBE (MUST) responder como inexistente con `RESOURCE_NOT_FOUND`.
Trace: FR-COMMITMENTS-012, FR-AUDIT-001, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta cancelar
- **CUANDO** el VIEWER intenta cancelar "Streamly"
- **ENTONCES** la operación se rechaza con `INSUFFICIENT_ROLE` y "Streamly" sigue activa

#### Scenario: Cambio auditado
- **CUANDO** el EDITOR cambia el plan de "Streamly" de "Premium" a "Estándar"
- **ENTONCES** el registro de auditoría de "Streamly" tiene una entrada con el EDITOR como actor y el plan "Premium" → "Estándar"

#### Scenario: Suscripción de otro workspace
- **CUANDO** un miembro del workspace B consulta "Streamly" del workspace A
- **ENTONCES** la respuesta es `RESOURCE_NOT_FOUND`

### Requirement: Corrección de un precio registrado por error
El EDITOR DEBE (MUST) poder corregir una entrada del historial de precios registrándole un reemplazo con la misma vigencia y otro monto; la entrada original DEBE (MUST) conservarse marcada como reemplazada y dejar de contar para el precio vigente, y la corrección DEBE (MUST) aplicarse a los cargos esperados no materializados con fecha igual o posterior a la vigencia, sin alterar cargos materializados ni transacciones. Una entrada ya reemplazada NO DEBE (MUST NOT) admitir otro reemplazo (`INVALID_STATUS_TRANSITION`).
Trace: FR-COMMITMENTS-013 · Priority: Should

#### Scenario: Monto tipeado mal
- **CUANDO** el EDITOR registró por error 129.90 USD desde 2027-03-15 para "Streamly" y lo corrige a 12.99 USD con la misma vigencia
- **ENTONCES** el precio vigente desde 2027-03-15 es 12.99 USD
- **Y** el historial conserva la entrada de 129.90 USD marcada como reemplazada por la de 12.99 USD

### Requirement: Cancelación programada al fin del ciclo pagado
El EDITOR DEBE (MUST) poder programar la cancelación de una suscripción `trial`, `active` o `paused` para una fecha futura: la suscripción DEBE (MUST) mantener su estado hasta esa fecha con la cancelación programada visible, los cargos con fecha igual o posterior a la fecha programada NO DEBEN (MUST NOT) quedar pendientes, y al llegar la fecha en la zona horaria del workspace el sistema DEBE (MUST) pasarla a `cancelled` una sola vez; antes de esa fecha el EDITOR DEBE (MUST) poder deshacer la programación.
Trace: FR-COMMITMENTS-017, FR-COMMITMENTS-012 · Priority: Should

#### Scenario: Cancelar al terminar el mes pagado
- **CUANDO** "Streamly" (renueva el día 15) se pagó el 2026-11-15 y el EDITOR programa la cancelación para el 2026-12-15 el día 2026-11-20
- **ENTONCES** "Streamly" sigue activa con cancelación programada para el 2026-12-15 y sin cargo esperado pendiente el 2026-12-15
- **Y** el 2026-12-15 a las 00:05 en America/La_Paz "Streamly" está `cancelled` con fecha de cancelación 2026-12-15

#### Scenario: Deshacer la cancelación programada
- **CUANDO** el 2026-12-01 el EDITOR deshace la cancelación programada de "Streamly"
- **ENTONCES** "Streamly" sigue activa sin cancelación programada y su próxima renovación es 2026-12-15

### Requirement: Detección de cambio de precio con tolerancia
Cuando un cargo de una suscripción se vincula a una transacción (al aprobar, crear automáticamente o emparejar el cargo) en la misma moneda que el precio, el sistema DEBE (MUST) comparar el monto de la transacción con el precio vigente en la fecha del cargo; si la diferencia absoluta supera la tolerancia de la suscripción (por defecto 1.00 % del precio vigente, configurable entre 0.00 % y 50.00 %), el sistema DEBE (MUST) crear una propuesta de precio pendiente con el monto observado y vigencia en la fecha del cargo y publicar `commitments.SubscriptionPriceChanged.v1` con origen detectado; una diferencia igual o menor a la tolerancia NO DEBE (MUST NOT) crear propuesta. La detección DEBE (MUST) ocurrir a lo sumo una vez por suscripción y fecha de cargo aunque el hecho de vinculación se reciba más de una vez, y NO DEBE (MUST NOT) cambiar el historial de precios por sí sola.
Trace: FR-COMMITMENTS-014 · Priority: Should

#### Scenario: Aumento detectado en el cargo
- **CUANDO** "MusicBox" tiene precio vigente 9.99 USD, se paga con "Visa USD" y el cargo del 2026-11-05 se vincula a una transacción de 11.99 USD
- **ENTONCES** existe una propuesta pendiente de 11.99 USD desde 2026-11-05 para "MusicBox"
- **Y** se publica el hecho de cambio de precio detectado de 9.99 USD a 11.99 USD con variación "+20.02"
- **Y** el precio vigente sigue siendo 9.99 USD

#### Scenario: Diferencia dentro de la tolerancia
- **CUANDO** el cargo del 2026-11-05 de "MusicBox" se vincula a una transacción de 10.05 USD (0.60 % sobre 9.99 USD)
- **ENTONCES** no se crea ninguna propuesta ni se publica ningún hecho de cambio de precio

#### Scenario: Diferencia exactamente en el límite
- **CUANDO** "Gimnasio Centro" tiene precio 250.00 BOB con tolerancia 1.00 % y su cargo se vincula a una transacción de 252.50 BOB
- **ENTONCES** no se crea ninguna propuesta

#### Scenario: Vinculación recibida dos veces
- **CUANDO** el hecho de vinculación del cargo del 2026-11-05 de "MusicBox" a la transacción de 11.99 USD se recibe dos veces
- **ENTONCES** existe una sola propuesta y se publicó un solo hecho de cambio de precio

### Requirement: Aceptar o rechazar una propuesta de precio
El EDITOR DEBE (MUST) poder aceptar una propuesta de precio pendiente, lo que DEBE (MUST) agregar al historial el precio propuesto con la vigencia de la propuesta (o, si esa vigencia no es posterior a la última entrada, con la fecha que el EDITOR indique y que sí lo sea) y actualizar la definición para los cargos no materializados desde esa vigencia, sin publicar un segundo hecho de cambio de precio; o rechazarla, lo que DEBE (MUST) dejar el historial sin cambios. Una suscripción DEBE (MUST) tener a lo sumo una propuesta pendiente: una detección nueva con otro monto DEBE (MUST) reemplazar la pendiente, y decidir una propuesta que ya no está pendiente DEBE (MUST) rechazarse con `SUBSCRIPTION_PROPOSAL_NOT_PENDING`.
Trace: FR-COMMITMENTS-014, FR-COMMITMENTS-013 · Priority: Should

#### Scenario: Aceptar el aumento detectado
- **CUANDO** el EDITOR acepta la propuesta de 11.99 USD desde 2026-11-05 de "MusicBox"
- **ENTONCES** el historial tiene 9.99 USD desde la primera renovación y 11.99 USD desde 2026-11-05
- **Y** el cargo esperado del 2026-12-05 es de 11.99 USD

#### Scenario: Rechazar un cargo extraordinario
- **CUANDO** el EDITOR rechaza la propuesta de 11.99 USD de "MusicBox"
- **ENTONCES** el precio vigente sigue siendo 9.99 USD y la propuesta queda rechazada

#### Scenario: Decidir dos veces
- **CUANDO** el EDITOR intenta aceptar la propuesta ya rechazada
- **ENTONCES** la operación se rechaza con `SUBSCRIPTION_PROPOSAL_NOT_PENDING`

### Requirement: Cargos en una moneda distinta del precio
Cuando el cargo vinculado está en una moneda distinta de la del precio (por ejemplo, una suscripción en USD cobrada en una tarjeta en BOB), el sistema DEBE (MUST) registrar el cargo con la tasa implícita (monto cobrado / precio vigente) para mostrar cuánto costó realmente cada renovación, y NO DEBE (MUST NOT) proponer un cambio de precio solo por la variación del tipo de cambio; el EDITOR DEBE (MUST) poder indicar en el cargo el monto cobrado en la moneda del precio (el del extracto de la tarjeta), y con ese dato el sistema DEBE (MUST) aplicar la detección de cambio de precio con la tolerancia de la suscripción.
Trace: FR-COMMITMENTS-014, FR-COMMITMENTS-012 · Priority: Should

#### Scenario: Cargo en BOB sin monto original
- **CUANDO** "Streamly" cuesta 10.99 USD, se paga con "Visa BOB" y su cargo del 2026-11-15 se vincula a una transacción de 108.50 BOB
- **ENTONCES** el cargo queda registrado como no comparable con tasa implícita 9.8726 BOB por USD
- **Y** no se crea ninguna propuesta de precio

#### Scenario: Monto en USD del extracto
- **CUANDO** el EDITOR indica que el cargo del 2026-11-15 de 108.50 BOB corresponde a 12.99 USD
- **ENTONCES** existe una propuesta pendiente de 12.99 USD desde 2026-11-15 con variación "+18.20"

### Requirement: Costo mensualizado y anualizado en moneda base
El sistema DEBE (MUST) mostrar, por suscripción y en total, el costo anualizado (precio vigente hoy × renovaciones por año del ciclo: semanal 52, quincenal 26, dos veces al mes 24, mensual 12, bimestral 6, trimestral 4, semestral 2, anual 1, diario 365, divididas por el intervalo; para reglas personalizadas, el número de renovaciones de los próximos 12 meses) y el mensualizado (anualizado / 12), en la moneda del precio y en la moneda base del workspace, convertidos con la tasa de valoración del par vigente hoy (tipo preferido, por defecto la paralela del provider de tasas) con la misma valoración que el Home y los presupuestos, sin redondeo intermedio y con HALF_EVEN a la escala de la moneda solo al presentar. El total DEBE (MUST) incluir solo las suscripciones `active` (incluidas las que tienen cancelación programada); las `trial` DEBEN (MUST) mostrarse aparte como costo al terminar el trial y las `paused` y `cancelled` DEBEN (MUST) excluirse. Sin tasa para una moneda, su parte DEBE (MUST) informarse sin convertir y el total marcarse incompleto, nunca a 1:1.
Trace: FR-COMMITMENTS-015 · Priority: Should

#### Scenario: Costo de las suscripciones del owner
- **CUANDO** hoy es 2026-11-10, las tasas paralelas vigentes son USD/BOB 9.80 y USDT/BOB 9.70, y están activas "Streamly" 10.99 USD mensual, "CloudDrive" 99.99 USD anual, "VPN Pro" 5.000000 USDT mensual y "Gimnasio Centro" 250.00 BOB mensual
- **ENTONCES** "Streamly" cuesta 107.70 BOB al mes y 1292.42 BOB al año, "CloudDrive" 81.66 BOB al mes y 979.90 BOB al año, "VPN Pro" 48.50 BOB al mes y 582.00 BOB al año y "Gimnasio Centro" 250.00 BOB al mes y 3000.00 BOB al año
- **Y** el total es 487.86 BOB al mes y 5854.33 BOB al año, completo, con las tasas usadas informadas

#### Scenario: Cadencia semanal
- **CUANDO** una suscripción activa cuesta 20.00 BOB semanal
- **ENTONCES** su costo es 1040.00 BOB al año y 86.67 BOB al mes

#### Scenario: Trial y pausada fuera del total
- **CUANDO** además "MusicBox" (9.99 USD mensual) está pausada y "PhotoLab" (4.99 USD mensual) está en trial
- **ENTONCES** el total sigue en 487.86 BOB al mes
- **Y** "PhotoLab" aparece aparte con 48.90 BOB al mes al terminar el trial

#### Scenario: Moneda sin tasa
- **CUANDO** no hay ninguna tasa USDT/BOB dentro de la ventana de vigencia
- **ENTONCES** el total mensual es 439.36 BOB marcado incompleto con 5.000000 USDT sin convertir

### Requirement: Recordatorio de renovación
Para cada suscripción `active` con recordatorios activados, el sistema DEBE (MUST) publicar `commitments.SubscriptionRenewalUpcoming.v1` cuando falten como máximo N días (configurable por suscripción entre 1 y 30, por defecto 3) para su próxima renovación en la zona horaria del workspace, a lo sumo una vez por suscripción y fecha de renovación aunque la evaluación se ejecute varias veces; si la fecha de renovación cambia, la nueva fecha DEBE (MUST) poder recordarse otra vez. Una renovación ya pasada NO DEBE (MUST NOT) recordarse.
Trace: FR-COMMITMENTS-016, FR-NOTIFY-005 · Priority: Should

#### Scenario: Tres días antes
- **CUANDO** "Streamly" renueva el 2026-11-15 con recordatorio a 3 días y la evaluación corre el 2026-11-12 a las 06:00 en America/La_Paz
- **ENTONCES** se publica un recordatorio de renovación de "Streamly" para el 2026-11-15

#### Scenario: Evaluación repetida
- **CUANDO** la evaluación vuelve a correr el 2026-11-12 y el 2026-11-13
- **ENTONCES** no se publica ningún otro recordatorio de "Streamly" para el 2026-11-15

#### Scenario: Suscripción creada dentro de la ventana
- **CUANDO** el 2026-11-14 se registra "Diario Digital" con primera renovación 2026-11-15 y recordatorio a 3 días
- **ENTONCES** se publica un recordatorio de renovación para el 2026-11-15 en la siguiente evaluación de ese día

### Requirement: Recordatorio de fin de trial
Para cada suscripción `trial` con recordatorios activados, el sistema DEBE (MUST) publicar `commitments.SubscriptionTrialEnding.v1` cuando falten como máximo N días (el mismo ajuste de la suscripción, por defecto 3) para el fin de trial en la zona horaria del workspace, a lo sumo una vez por suscripción y fecha de fin de trial, indicando el precio que se cobrará en la primera renovación.
Trace: FR-COMMITMENTS-016, FR-NOTIFY-005 · Priority: Should

#### Scenario: Trial que termina en tres días
- **CUANDO** "CloudDrive" está en trial hasta el 2026-11-20 con recordatorio a 3 días y la evaluación corre el 2026-11-17
- **ENTONCES** se publica un recordatorio de fin de trial de "CloudDrive" para el 2026-11-20 con primer cobro de 99.99 USD
- **Y** una segunda evaluación el 2026-11-18 no publica otro

### Requirement: Recorrido de la suscripción
El sistema DEBE (MUST) registrar cada transición de estado de una suscripción (alta, fin de trial, pausa, reanudación, cancelación programada o deshecha, cancelación) con actor (usuario o proceso), instante y motivo, y DEBE (MUST) permitir a todo miembro consultarlas en orden como recorrido de la suscripción; los cambios de precio, plan o cuenta DEBEN (MUST) aparecer como anotaciones del recorrido sin ser transiciones de estado.
Trace: FR-COMMITMENTS-012, FR-AUDIT-009 · Priority: Should

#### Scenario: Recorrido de una suscripción con trial
- **CUANDO** "CloudDrive" se registró en trial el 2026-10-20, pasó a activa el 2026-11-20 por el proceso de fin de trial y el EDITOR la pausó el 2027-01-03
- **ENTONCES** su recorrido muestra en orden: alta en trial (EDITOR, 2026-10-20), fin de trial a activa (proceso, 2026-11-20) y pausa (EDITOR, 2027-01-03)
