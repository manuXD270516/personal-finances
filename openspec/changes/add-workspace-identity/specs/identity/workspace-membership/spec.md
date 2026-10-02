# Spec Delta

## Purpose

Define el workspace como unidad de aislamiento de las finanzas: su creación automática en el primer login, su configuración (moneda base, zona horaria, locale, mes financiero, reserva de liquidez) y la pertenencia de un usuario a uno o varios workspaces con un rol.

## ADDED Requirements

### Requirement: Workspace personal creado en el primer login
En el primer login de un usuario sin membresías, el sistema DEBE (MUST) crear un workspace personal con ese usuario como único miembro con rol OWNER, moneda base BOB, zona horaria America/La_Paz, locale es-BO y día de inicio del mes financiero 1, sin reserva mínima de liquidez.
Trace: FR-IDENTITY-004 · Priority: Must

#### Scenario: Primer login de un usuario nuevo
- **CUANDO** el usuario "nuevo@demo.pfos.test" inicia sesión por primera vez y no pertenece a ningún workspace
- **ENTONCES** existe un workspace nuevo con moneda base BOB, zona horaria "America/La_Paz", locale "es-BO" y día de inicio del mes 1
- **Y** "nuevo@demo.pfos.test" es su único miembro, con rol OWNER
- **Y** se publica el evento de workspace creado

#### Scenario: Usuario que ya pertenece a un workspace
- **CUANDO** el usuario "viewer@demo.pfos.test", VIEWER de "W1 Personal Demo", inicia sesión por primera vez
- **ENTONCES** no se crea un workspace personal y su lista de workspaces contiene solo "W1 Personal Demo"

### Requirement: Provisión idempotente del workspace personal
La creación del workspace personal DEBE (MUST) ser idempotente: logins repetidos o concurrentes del mismo usuario NO DEBEN (MUST NOT) crear más de un workspace personal.
Trace: FR-IDENTITY-004 · Priority: Must

#### Scenario: Dos primeros logins concurrentes
- **CUANDO** el mismo usuario nuevo completa dos logins simultáneos desde dos navegadores
- **ENTONCES** existe exactamente un workspace personal con ese usuario como OWNER
- **Y** se publica exactamente un evento de workspace creado

#### Scenario: Login posterior
- **CUANDO** un usuario que ya tiene su workspace personal vuelve a iniciar sesión
- **ENTONCES** no se crea ningún workspace adicional

### Requirement: Configuración del workspace por el OWNER
El OWNER DEBE (MUST) poder cambiar el nombre, la moneda base, la zona horaria (identificador IANA), el locale de formato y el día de inicio del mes financiero (1 a 28) del workspace usando control de concurrencia optimista; valores inválidos DEBEN (MUST) rechazarse sin modificar el workspace.
Trace: FR-IDENTITY-005 · Priority: Must

#### Scenario: OWNER actualiza la configuración
- **CUANDO** el OWNER de "W1 Personal Demo" cambia el nombre a "Finanzas personales", el locale a "es-BO" y el día de inicio del mes a 5, enviando la versión vigente
- **ENTONCES** el workspace devuelve los valores nuevos con una versión nueva
- **Y** se publica el evento de configuración del workspace cambiada

#### Scenario: Zona horaria inválida
- **CUANDO** el OWNER envía la zona horaria "GMT-4 Bolivia"
- **ENTONCES** la respuesta es 422 con código `INVALID_TIMEZONE` y la configuración no cambia

#### Scenario: Día de inicio del mes fuera de rango
- **CUANDO** el OWNER envía el día de inicio del mes 29
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED` y la configuración no cambia

#### Scenario: Moneda base inexistente
- **CUANDO** el OWNER envía la moneda base "XYZ", que no existe en el catálogo de monedas
- **ENTONCES** la respuesta es 422 con código `REFERENCE_NOT_FOUND` y la moneda base no cambia

### Requirement: Cambio de moneda base sin alterar la historia
Cambiar la moneda base del workspace NO DEBE (MUST NOT) modificar montos, monedas ni asientos ya registrados ni tasas históricas; el cambio DEBE (MUST) afectar solo la moneda en que se presentan vistas y reportes.
Trace: FR-IDENTITY-005 · Priority: Must

#### Scenario: Cambio de BOB a USD con historia multi-moneda
- **CUANDO** el workspace "W1 Personal Demo" tiene un gasto de 685.00 BOB y una conversión de 100.000000 USDT a 685.00 BOB, y el OWNER cambia la moneda base de BOB a USD
- **ENTONCES** el gasto sigue registrado por 685.00 BOB y la conversión por 100.000000 USDT y 685.00 BOB
- **Y** no se crea, modifica ni revierte ningún asiento contable
- **Y** la moneda base del workspace es USD

### Requirement: Reserva mínima de liquidez del workspace
El OWNER DEBE (MUST) poder definir u omitir una reserva mínima de liquidez del workspace expresada como monto con moneda, no negativo y con la escala de esa moneda; un monto con más decimales que la escala de su moneda DEBE (MUST) rechazarse.
Trace: FR-IDENTITY-005 · Priority: Must

#### Scenario: Definir la reserva mínima
- **CUANDO** el OWNER define la reserva mínima de liquidez en 1500.00 BOB
- **ENTONCES** el workspace devuelve la reserva mínima `{"amount": "1500.00", "currency": "BOB"}`

#### Scenario: Reserva con escala excesiva
- **CUANDO** el OWNER define la reserva mínima en 1500.005 BOB
- **ENTONCES** la respuesta es 422 con código `AMOUNT_SCALE_EXCEEDED` y la reserva no cambia

#### Scenario: Quitar la reserva
- **CUANDO** el OWNER elimina la reserva mínima enviando un valor nulo
- **ENTONCES** el workspace queda sin reserva mínima de liquidez

### Requirement: Listado de workspaces del usuario
El sistema DEBE (MUST) listar para el usuario autenticado únicamente los workspaces donde tiene membresía activa, indicando su rol en cada uno, con paginación por cursor.
Trace: FR-IDENTITY-007 · Priority: Should

#### Scenario: Usuario con varios workspaces
- **CUANDO** "owner@demo.pfos.test", OWNER de "W1 Personal Demo" y de "W2 Other Demo", lista sus workspaces
- **ENTONCES** la respuesta contiene exactamente "W1 Personal Demo" y "W2 Other Demo", ambos con rol OWNER

#### Scenario: Usuario con un solo workspace
- **CUANDO** "outsider@demo.pfos.test", OWNER solo de "W2 Other Demo", lista sus workspaces
- **ENTONCES** la respuesta contiene solo "W2 Other Demo"

### Requirement: Creación de workspaces adicionales
Un usuario autenticado DEBE (MUST) poder crear un workspace adicional indicando nombre y moneda base, quedando como su OWNER; la zona horaria y el locale DEBEN (MUST) tomar America/La_Paz y es-BO cuando no se indiquen. La creación DEBE (MUST) exigir clave de idempotencia.
Trace: FR-IDENTITY-007 · Priority: Should

#### Scenario: Crear un workspace del hogar
- **CUANDO** "owner@demo.pfos.test" crea el workspace "Hogar" con moneda base BOB y una clave de idempotencia nueva
- **ENTONCES** la respuesta es 201 con el workspace "Hogar", zona horaria "America/La_Paz", locale "es-BO" y rol OWNER
- **Y** "Hogar" aparece en su lista de workspaces

### Requirement: Selección del workspace activo
La interfaz DEBE (MUST) permitir al usuario elegir entre sus workspaces el workspace activo y DEBE (MUST) enviar el identificador de ese workspace de forma explícita en toda petición de negocio; el servidor NO DEBE (MUST NOT) inferir un workspace implícito.
Trace: FR-IDENTITY-007 · Priority: Should

#### Scenario: Cambiar de workspace activo
- **CUANDO** "owner@demo.pfos.test" cambia el workspace activo de "W1 Personal Demo" a "W2 Other Demo"
- **ENTONCES** las vistas muestran solo datos de "W2 Other Demo", incluida la cuenta "W2 Bank" con 5000.00 BOB
- **Y** las peticiones de negocio que envía la interfaz incluyen el identificador de "W2 Other Demo" en la ruta
