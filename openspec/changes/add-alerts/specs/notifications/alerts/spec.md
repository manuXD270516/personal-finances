# Spec Delta

## Purpose

Avisa a cada miembro del workspace de los hechos que requieren su atención —en Phase 2, umbrales de presupuesto alcanzados y meses pendientes de cierre— mediante un centro de notificaciones in-app y, opcionalmente, por email, con una sola notificación por hecho de origen aunque el evento se reentregue, sin montos en los emails salvo opt-in explícito, en el idioma del usuario (es, en, pt) y respetando sus preferencias por tipo y canal y su horario de silencio.

## ADDED Requirements

### Requirement: Notificación in-app por umbral de presupuesto alcanzado
Por cada hecho de umbral de presupuesto alcanzado, el sistema DEBE (MUST) crear una notificación in-app no leída de tipo umbral de presupuesto para cada miembro activo del workspace que no la haya desactivado, con el objetivo, el periodo, el umbral más alto, los umbrales menores cruzados a la vez, el planificado y el gastado.
Trace: FR-NOTIFY-004, FR-NOTIFY-001 · Priority: Must

#### Scenario: Dos miembros notificados
- **CUANDO** el workspace tiene un OWNER y un VIEWER activos y se publica el hecho de umbral 90 % (también 50 y 75 %) de "Restaurantes" en "2026-11" con planificado 600.00 BOB y gastado 550.00 BOB
- **ENTONCES** cada uno tiene una notificación no leída de umbral de presupuesto de "Restaurantes", "2026-11", 90 % (también 50 y 75 %), 550.00 de 600.00 BOB

#### Scenario: Miembro que desactivó el tipo in-app
- **CUANDO** el VIEWER desactivó las notificaciones in-app de umbral de presupuesto
- **ENTONCES** solo el OWNER recibe la notificación

### Requirement: Centro de notificaciones con estados y contador
Cada usuario DEBE (MUST) poder listar sus notificaciones del workspace de la más reciente a la más antigua, filtrar por estado no leída, leída o archivada, conocer el número de no leídas y marcar una como leída, marcar todas como leídas o archivar una; las archivadas NO DEBEN (MUST NOT) aparecer en la lista por defecto ni en el contador.
Trace: FR-NOTIFY-001 · Priority: Must

#### Scenario: Leer y archivar
- **CUANDO** el OWNER tiene 3 notificaciones no leídas, marca una como leída y archiva otra
- **ENTONCES** el contador de no leídas es 1
- **Y** la lista por defecto muestra 2 notificaciones y la archivada solo aparece al filtrar por archivadas

#### Scenario: Marcar todas como leídas
- **CUANDO** el OWNER marca todas como leídas
- **ENTONCES** el contador de no leídas es 0

### Requirement: Enlace al recurso de origen
Cada notificación DEBE (MUST) enlazar al recurso que la originó (la línea de presupuesto del periodo o el periodo pendiente de cierre); si el recurso ya no existe, el enlace DEBE (MUST) llevar al contenedor más cercano (el plan del periodo) indicando que el elemento ya no está disponible.
Trace: FR-NOTIFY-001 · Priority: Must

#### Scenario: Enlace a la línea de presupuesto
- **CUANDO** el OWNER abre la notificación de umbral de "Restaurantes" en "2026-11"
- **ENTONCES** la app muestra el plan de "2026-11" con la línea "Restaurantes" resaltada

#### Scenario: Línea eliminada después
- **CUANDO** la línea "Restaurantes" fue quitada del plan antes de abrir la notificación
- **ENTONCES** la app muestra el plan de "2026-11" con el aviso de que la línea ya no existe

### Requirement: Notificaciones privadas de cada usuario
Un usuario DEBE (MUST) ver y modificar solo sus propias notificaciones del workspace activo; consultar, marcar o archivar la notificación de otro usuario o de otro workspace DEBE (MUST) responder como inexistente con `RESOURCE_NOT_FOUND`.
Trace: FR-NOTIFY-001, NFR-SEC-003 · Priority: Must

#### Scenario: Notificación de otro miembro
- **CUANDO** el VIEWER intenta marcar como leída una notificación del OWNER
- **ENTONCES** la operación responde `RESOURCE_NOT_FOUND` y la notificación del OWNER sigue no leída

### Requirement: Una sola notificación por hecho de origen
El sistema DEBE (MUST) crear a lo sumo una notificación por destinatario y hecho de origen aunque el evento se entregue más de una vez o lo procesen dos instancias a la vez, combinando el registro de eventos procesados por consumidor con una clave de deduplicación de negocio.
Trace: FR-NOTIFY-005 · Priority: Must

#### Scenario: Evento reentregado
- **CUANDO** el hecho de umbral 90 % de "Restaurantes" en "2026-11" se entrega dos veces
- **ENTONCES** el OWNER tiene una sola notificación de ese umbral

#### Scenario: Mismo hecho con otro identificador de evento
- **CUANDO** llega un segundo evento con otro identificador pero el mismo objetivo, periodo y umbral 90 %
- **ENTONCES** no se crea una segunda notificación

### Requirement: Aviso de cierre de mes pendiente
Por cada hecho de periodo terminado pendiente de cierre publicado por Planning, el sistema DEBE (MUST) crear una sola notificación de tipo cierre pendiente para cada miembro con permiso de cerrar el periodo (OWNER y EDITOR) que no la haya desactivado.
Trace: FR-NOTIFY-004 · Priority: Must

#### Scenario: Octubre sin cerrar
- **CUANDO** el periodo "2026-10" terminó, sigue abierto y Planning publica el hecho de cierre pendiente de "2026-10"
- **ENTONCES** el OWNER y el EDITOR tienen una notificación de cierre pendiente de "2026-10" con enlace al cierre del periodo
- **Y** el VIEWER no recibe esa notificación

### Requirement: Emails sin montos salvo opt-in explícito
Los emails de notificación NO DEBEN (MUST NOT) incluir montos, saldos, nombres de categorías, cuentas ni descripciones, salvo que el destinatario haya activado explícitamente la inclusión de detalles en sus preferencias; el contenido in-app no cambia por esta opción.
Trace: FR-NOTIFY-006, NFR-COMP-001 · Priority: Must

#### Scenario: Email sin detalles por defecto
- **CUANDO** el OWNER, con email activado y sin opt-in de detalles, recibe el umbral 90 % de "Restaurantes" en "2026-11"
- **ENTONCES** el email dice que una línea de su presupuesto de "2026-11" alcanzó el 90 %
- **Y** no contiene "Restaurantes", "550.00", "600.00" ni "BOB"

#### Scenario: Email con detalles por opt-in
- **CUANDO** el OWNER activó la inclusión de detalles en el email
- **ENTONCES** el email indica "Restaurantes", 90 % y 550.00 de 600.00 BOB

### Requirement: Emails enlazan a la app autenticada
Todo email de notificación DEBE (MUST) enlazar a la notificación dentro de la app en la URL pública configurada, exigiendo sesión iniciada para verla; el enlace NO DEBE (MUST NOT) contener tokens de acceso, credenciales ni datos financieros.
Trace: FR-NOTIFY-006 · Priority: Must

#### Scenario: Enlace sin sesión
- **CUANDO** el destinatario abre el enlace del email sin sesión iniciada
- **ENTONCES** la app le pide iniciar sesión y luego muestra la notificación
- **Y** el enlace solo contiene la ruta y el identificador opaco de la notificación

### Requirement: Idioma de la notificación según el usuario
El texto de las notificaciones in-app y de los emails DEBE (MUST) presentarse en el idioma del locale del destinatario (español, inglés o portugués), con español como respaldo para otros locales, y con montos y fechas en el formato de ese locale; cambiar el locale DEBE (MUST) cambiar el idioma de las notificaciones in-app ya existentes.
Trace: NFR-USAB-001, NFR-USAB-002, FR-NOTIFY-002 · Priority: Must

#### Scenario: Usuario en inglés
- **CUANDO** el OWNER tiene locale "en-US" y recibe el umbral 90 % de "2026-11" sin opt-in de detalles
- **ENTONCES** el asunto del email es "You have a budget alert" y la notificación in-app está en inglés

#### Scenario: Usuario en portugués
- **CUANDO** el EDITOR tiene locale "pt-BR"
- **ENTONCES** el asunto del email es "Você tem um alerta de orçamento"

#### Scenario: Locale sin traducción
- **CUANDO** el VIEWER tiene locale "fr-FR"
- **ENTONCES** recibe la notificación en español

### Requirement: Entrega por email
Para cada notificación cuyo destinatario tenga el canal email activado para ese tipo y un email verificado, el sistema DEBE (MUST) enviar un email a través del proveedor de email configurado; en los entornos local y de CI el envío DEBE (MUST) capturarse en el servidor de correo de pruebas sin salir a internet.
Trace: FR-NOTIFY-002 · Priority: Should

#### Scenario: Email capturado en local
- **CUANDO** en el entorno local el OWNER tiene email activado y recibe el umbral 90 % de "Restaurantes"
- **ENTONCES** el servidor de correo de pruebas contiene un email para la dirección del OWNER con asunto "Tienes una alerta de presupuesto"

### Requirement: Email entregado una sola vez
Cada notificación DEBE (MUST) generar como máximo un envío aceptado por el proveedor por canal email: reentregas del evento, reintentos del trabajo de envío tras un envío aceptado o dos instancias procesando a la vez NO DEBEN (MUST NOT) producir un segundo email.
Trace: FR-NOTIFY-002, FR-NOTIFY-005 · Priority: Should

#### Scenario: Reintento tras envío aceptado
- **CUANDO** el envío del email del umbral 90 % fue aceptado por el proveedor y el trabajo de envío se ejecuta otra vez
- **ENTONCES** el servidor de correo de pruebas contiene un solo email para esa notificación

### Requirement: Reintentos de email sin afectar el in-app
Si el proveedor de email falla, el sistema DEBE (MUST) reintentar el envío con espera creciente hasta 5 intentos y luego marcar la entrega como fallida con métrica; la notificación in-app DEBE (MUST) existir desde el principio, independiente del resultado del email.
Trace: FR-NOTIFY-002, NFR-REL-008 · Priority: Should

#### Scenario: Proveedor caído
- **CUANDO** el proveedor de email rechaza los 5 intentos de envío del umbral 90 %
- **ENTONCES** la entrega por email queda fallida y se registra en la métrica de entregas fallidas
- **Y** el OWNER tiene la notificación in-app no leída desde el primer intento

### Requirement: Preferencias por tipo y canal
Cada usuario DEBE (MUST) poder activar o desactivar, por workspace, cada tipo de notificación en cada canal (in-app y email) y la inclusión de detalles en el email; por defecto ambos canales están activos y la inclusión de detalles desactivada; un tipo desactivado en un canal NO DEBE (MUST NOT) producir notificaciones nuevas en ese canal.
Trace: FR-NOTIFY-003 · Priority: Should

#### Scenario: Solo in-app para umbrales
- **CUANDO** el OWNER desactiva el email para umbral de presupuesto y luego se publica el umbral 100 % de "Restaurantes"
- **ENTONCES** el OWNER tiene la notificación in-app y no se envía ningún email

### Requirement: Horario de silencio difiere los emails
Si el usuario configuró un horario de silencio (inicio y fin en su zona horaria, que puede cruzar la medianoche), los emails que correspondan dentro de ese horario DEBEN (MUST) enviarse al terminar el horario y no descartarse; la notificación in-app DEBE (MUST) crearse en el momento.
Trace: FR-NOTIFY-003 · Priority: Should

#### Scenario: Silencio de 22:00 a 07:00
- **CUANDO** el OWNER tiene silencio de 22:00 a 07:00 en America/La_Paz y el umbral 90 % se publica el 2026-11-12 a las 23:15 (hora de La Paz)
- **ENTONCES** la notificación in-app existe desde las 23:15
- **Y** el email se envía el 2026-11-13 a partir de las 07:00 (hora de La Paz)

### Requirement: Canal email deshabilitado por entorno
Cuando el canal email está deshabilitado por configuración del entorno, el sistema DEBE (MUST) registrar las entregas por email como suprimidas sin error ni reintentos y sin afectar las notificaciones in-app.
Trace: FR-NOTIFY-002 · Priority: Should

#### Scenario: Email deshabilitado
- **CUANDO** el canal email está deshabilitado en el entorno y se publica el umbral 90 % de "Restaurantes"
- **ENTONCES** el OWNER tiene la notificación in-app y la entrega por email queda suprimida
