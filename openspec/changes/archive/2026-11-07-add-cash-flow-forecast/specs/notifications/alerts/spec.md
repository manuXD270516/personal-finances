## ADDED Requirements

### Requirement: Notificación de riesgo de déficit
Cuando se abre un episodio de riesgo de déficit de una moneda, el sistema DEBE (MUST) crear una notificación de tipo riesgo de déficit para cada OWNER y EDITOR activo del workspace, con la moneda, la primera fecha bajo el umbral, el saldo más bajo esperado, el umbral y el enlace al calendario de flujo de caja, de severidad crítica si el saldo más bajo es negativo y de advertencia si solo queda bajo la reserva mínima, una sola vez por episodio y destinatario aunque el hecho se entregue varias veces; el cierre del episodio NO DEBE (MUST NOT) generar notificación. DEBE (MUST) respetar las preferencias por tipo y canal y el horario de silencio.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-REPORTING-015 · Priority: Must

#### Scenario: Déficit bajo cero
- **CUANDO** se abre el episodio de BOB con saldo más bajo −679.00 BOB, primera fecha bajo el umbral 2026-11-01 y umbral 1500.00 BOB
- **ENTONCES** el OWNER y el EDITOR reciben una notificación crítica de riesgo de déficit en BOB con la fecha 2026-11-01 y el enlace al calendario
- **Y** el VIEWER no la recibe

#### Scenario: Solo bajo la reserva mínima
- **CUANDO** se abre el episodio de BOB con saldo más bajo 621.00 BOB y umbral 1500.00 BOB
- **ENTONCES** la notificación es de severidad advertencia

#### Scenario: Hecho entregado dos veces
- **CUANDO** el mismo episodio se entrega dos veces
- **ENTONCES** cada destinatario tiene una sola notificación de ese episodio

#### Scenario: Episodio cerrado y uno nuevo
- **CUANDO** el episodio se cierra y días después se abre otro episodio de BOB
- **ENTONCES** el cierre no genera notificación y el episodio nuevo genera una notificación nueva por destinatario

### Requirement: Emails de riesgo de déficit sin montos salvo opt-in
Los emails de riesgo de déficit NO DEBEN (MUST NOT) incluir montos, el umbral ni nombres de cuentas, salvo que el destinatario haya activado la inclusión de detalles en sus preferencias; sin opt-in DEBEN (MUST) incluir solo la moneda, la primera fecha bajo el umbral y el enlace a la app autenticada. El contenido in-app no cambia por esta opción.
Trace: FR-NOTIFY-006, NFR-COMP-001 · Priority: Must

#### Scenario: Email sin opt-in
- **CUANDO** el OWNER, con email activado y sin opt-in de detalles, recibe el riesgo de déficit de BOB con saldo más bajo −679.00 BOB el 2026-11-01 y umbral 1500.00 BOB
- **ENTONCES** el email indica riesgo de déficit en BOB a partir del 01/11/2026 con el enlace al calendario
- **Y** no contiene −679.00, 1500.00 ni "Banco BOB"

#### Scenario: Email con opt-in
- **CUANDO** el OWNER activó la inclusión de detalles
- **ENTONCES** el email muestra además el saldo más bajo esperado −679.00 BOB y el umbral 1500.00 BOB

### Requirement: Idioma de las notificaciones de déficit y del digest
Los textos in-app y de email del riesgo de déficit y los emails del digest DEBEN (MUST) existir en español, inglés y portugués, en el idioma del locale del destinatario con español como respaldo, y con montos, porcentajes y fechas en el formato de ese locale.
Trace: NFR-USAB-001, NFR-USAB-002, FR-NOTIFY-002 · Priority: Must

#### Scenario: Riesgo de déficit en inglés
- **CUANDO** el EDITOR tiene locale "en-US" y recibe el riesgo de déficit de BOB del 2026-11-01 sin opt-in de detalles
- **ENTONCES** la notificación y el email están en inglés con la fecha 11/01/2026

#### Scenario: Locale no soportado
- **CUANDO** el OWNER tiene locale "fr-FR" y recibe el digest semanal
- **ENTONCES** el digest está en español

### Requirement: Frecuencia del digest en las preferencias
Cada usuario DEBE (MUST) poder elegir en sus preferencias del workspace la frecuencia del digest por email: desactivado (por omisión), semanal o mensual; un valor distinto DEBE (MUST) rechazarse con `VALIDATION_FAILED` sin cambiar las preferencias, y cada cambio DEBE (MUST) auditarse como el resto de las preferencias.
Trace: FR-NOTIFY-007, FR-NOTIFY-003 · Priority: Should

#### Scenario: Activar el digest semanal
- **CUANDO** el OWNER, sin digest configurado, guarda la frecuencia semanal
- **ENTONCES** sus preferencias indican digest semanal y el cambio queda auditado con el valor anterior "desactivado"

#### Scenario: Valor inválido
- **CUANDO** el OWNER guarda la frecuencia "diaria"
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED` y la frecuencia no cambia

### Requirement: Digest periódico del Home por email
El sistema DEBE (MUST) enviar a cada miembro activo que eligió el digest un email con el resumen de las nueve preguntas del Home de ese workspace al momento de generarlo: el semanal los lunes a las 08:00 y el mensual el primer día de cada periodo financiero a las 08:00, en la zona del workspace. Una pregunta sin datos DEBE (MUST) indicarse como tal, nunca con un cero sustituto; el digest NO DEBE (MUST NOT) aparecer en el centro de notificaciones y DEBE (MUST) enlazar al Home y a las preferencias en la app autenticada. Con el canal email deshabilitado por entorno, el digest NO DEBE (MUST NOT) enviarse.
Trace: FR-NOTIFY-007, FR-REPORTING-001 · Priority: Should

#### Scenario: Digest semanal del lunes
- **CUANDO** el OWNER y un VIEWER de "W1" eligieron el digest semanal y llega el lunes 2026-11-02 a las 08:00 en La Paz
- **ENTONCES** cada uno recibe un email con el resumen de Q1 a Q9 de "W1"
- **Y** el centro de notificaciones de ninguno muestra el digest

#### Scenario: Digest mensual con día de inicio 25
- **CUANDO** el EDITOR eligió el digest mensual y el día de inicio del mes financiero es 25
- **ENTONCES** recibe el digest el 2026-10-25 a las 08:00 en La Paz y no lo recibe el 2026-11-01

#### Scenario: Pregunta sin datos
- **CUANDO** el workspace no tiene metas al generar el digest
- **ENTONCES** la sección de Q9 indica que no hay metas, sin 0 %

#### Scenario: Digest desactivado
- **CUANDO** el EDITOR no eligió el digest
- **ENTONCES** no recibe ningún digest

### Requirement: Digest sin montos salvo opt-in
El digest NO DEBE (MUST NOT) incluir saldos, montos, nombres de cuentas, categorías, metas ni compromisos salvo que el destinatario haya activado la inclusión de detalles; sin opt-in DEBE (MUST) resumir cada pregunta solo con cantidades, porcentajes, estados y fechas.
Trace: FR-NOTIFY-006, FR-NOTIFY-007, NFR-COMP-001 · Priority: Must

#### Scenario: Digest sin opt-in
- **CUANDO** al generar el digest hay 3 pagos en los próximos 7 días, la tasa de ahorro del periodo es 41.5 %, el riesgo de déficit de 30 días es alto en BOB desde el 2026-11-15, el disponible para gastar es 5521.00 BOB y el OWNER no activó la inclusión de detalles
- **ENTONCES** el digest indica 3 pagos próximos, 41.5 % de tasa de ahorro, riesgo alto desde el 15/11/2026 y disponible para gastar positivo
- **Y** no contiene 5521.00 ni ningún otro monto

#### Scenario: Digest con opt-in
- **CUANDO** el OWNER activó la inclusión de detalles
- **ENTONCES** el digest muestra además el disponible para gastar 5521.00 BOB y los montos consolidados de las demás preguntas

### Requirement: Digest con horario de silencio y una sola vez por periodo
El digest DEBE (MUST) enviarse una sola vez por destinatario, workspace y semana o periodo financiero aunque el proceso que lo genera se ejecute varias veces; si su hora cae dentro del horario de silencio del destinatario DEBE (MUST) enviarse al terminar el horario; si el proceso no corrió a la hora prevista DEBE (MUST) enviarse en la primera ejecución dentro de la misma semana o periodo, y pasado ese lapso NO DEBE (MUST NOT) enviarse atrasado.
Trace: FR-NOTIFY-007, FR-NOTIFY-003, FR-NOTIFY-005 · Priority: Should

#### Scenario: Silencio hasta las 09:00
- **CUANDO** el OWNER tiene silencio de 22:00 a 09:00 en La Paz y digest semanal
- **ENTONCES** el digest del lunes 2026-11-02 se envía a las 09:00

#### Scenario: Proceso ejecutado dos veces
- **CUANDO** el proceso del digest corre a las 08:05 y de nuevo a las 09:05 del lunes 2026-11-02
- **ENTONCES** el OWNER recibe un solo digest de esa semana

#### Scenario: Worker caído el lunes
- **CUANDO** el worker no corre el lunes 2026-11-02 y vuelve el miércoles 2026-11-04 a las 10:00
- **ENTONCES** el digest de esa semana se envía el 2026-11-04
- **Y** si vuelve recién el lunes 2026-11-09 solo se envía el digest de la semana nueva

### Requirement: Frecuencia del digest en la portabilidad del workspace
La frecuencia del digest DEBERÍA (SHOULD) exportarse e importarse con las preferencias de notificación del usuario; un archivo exportado antes de este cambio, sin la frecuencia, DEBE (MUST) importarse con el digest desactivado.
Trace: FR-NOTIFY-007, FR-IDENTITY-010 · Priority: Could

#### Scenario: Exportar e importar el digest semanal
- **CUANDO** el OWNER con digest semanal exporta el workspace y lo importa en otro
- **ENTONCES** sus preferencias importadas tienen digest semanal

#### Scenario: Archivo anterior sin frecuencia
- **CUANDO** se importa un archivo exportado antes de este cambio
- **ENTONCES** el digest queda desactivado
