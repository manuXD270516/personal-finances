## ADDED Requirements

### Requirement: Pares de tasa configurados por workspace
Cada workspace DEBE (MUST) tener una lista de pares de tasa automáticos, sin repetir, cuya moneda base esté habilitada en el workspace y cuya moneda quote sea la moneda base del workspace o la moneda pivote USDT. Mientras el workspace no fije su lista, DEBE (MUST) usarse la lista por defecto: cada moneda fiat o estable habilitada frente a la moneda base, cada criptomoneda volátil habilitada frente a USDT y, si hay alguna, USDT frente a la moneda base. Un OWNER o EDITOR DEBE (MUST) poder fijar la lista o volver a la lista por defecto; cada cambio DEBE (MUST) quedar en la auditoría, y un VIEWER NO DEBE (MUST NOT) cambiarla. Quitar un par DEBE (MUST) dejar de registrar sus tasas automáticas en el workspace y NO DEBE (MUST NOT) borrar ni modificar su histórico. Los pares configurados no tienen estados propios.
Trace: FR-FX-009, FR-FX-002, FR-AUDIT-001 · Priority: Must

#### Scenario: Lista por defecto
- **CUANDO** un workspace con moneda base BOB tiene habilitadas BOB, USD, USDT y BTC y nunca fijó su lista de pares
- **ENTONCES** sus pares automáticos son USD/BOB, USDT/BOB y BTC/USDT

#### Scenario: El EDITOR agrega ETH
- **CUANDO** el EDITOR habilita ETH y fija la lista USD/BOB, USDT/BOB, BTC/USDT y ETH/USDT
- **ENTONCES** la lista queda guardada con esos cuatro pares y la auditoría registra quién la cambió, cuándo y las listas anterior y nueva

#### Scenario: Quitar un par conserva su histórico
- **CUANDO** el OWNER quita BTC/USDT, que tiene 217 tasas diarias y muestras de los últimos días
- **ENTONCES** los ciclos siguientes no registran tasas BTC/USDT en el workspace
- **Y** las tasas BTC/USDT ya registradas siguen consultables con los mismos valores

#### Scenario: VIEWER sin permiso
- **CUANDO** un VIEWER intenta fijar la lista de pares
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y la lista no cambia

#### Scenario: Par con una moneda no habilitada
- **CUANDO** el EDITOR fija una lista con ETH/USDT y ETH no está habilitada en el workspace
- **ENTONCES** se rechaza con `CURRENCY_NOT_ENABLED` y la lista no cambia

#### Scenario: Quote distinta de la moneda base y de USDT
- **CUANDO** el EDITOR fija una lista con BTC/USD en un workspace con moneda base BOB
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y la lista no cambia

### Requirement: Registro automático solo para los pares configurados
El proceso programado DEBE (MUST) registrar en cada workspace solo las muestras de los pares de su lista configurada (con todos los tipos que los providers publican para ese par) y NO DEBE (MUST NOT) registrar pares que el workspace no configuró. Un par configurado que ningún provider habilitado publica DEBE (MUST) informarse como cubierto solo por tasas manuales.
Trace: FR-FX-009, FR-FX-016 · Priority: Must

#### Scenario: Workspace sin USD/BOB
- **CUANDO** "W1" configura solo USDT/BOB y BTC/USDT y paralelo.bo publica la mediana 12.02 para USD/BOB y USDT/BOB
- **ENTONCES** "W1" registra USDT/BOB `PARALLEL` 12.02 y no registra ninguna tasa USD/BOB de esa muestra

#### Scenario: Par sin provider
- **CUANDO** "W1" configura EUR/BOB y ningún provider habilitado publica EUR/BOB
- **ENTONCES** el estado de sus pares informa EUR/BOB como cubierto solo por tasas manuales
- **Y** el resto de los pares se registra con normalidad

### Requirement: Precios de mercado de criptomonedas desde providers de exchange
El sistema DEBE (MUST) obtener precios spot de criptomonedas mediante un provider principal (API pública de datos de mercado de un exchange, sin clave) y un provider de respaldo independiente (otro exchange o un agregador), y registrarlos como tasas tipo `MARKET` de cada criptomoneda frente a USDT, con valor = último precio publicado y vigencia = instante publicado por el provider. El valor DEBE (MUST) leerse como decimal exacto con las mismas reglas que las tasas de los providers de tasa paralela, y un provider NO DEBE (MUST NOT) habilitarse sin la verificación de términos registrada (requirement "Providers habilitados solo con términos verificados").
Trace: FR-FX-009, NFR-COMP-007 · Priority: Must

#### Scenario: Muestra del provider cripto principal
- **CUANDO** el provider cripto principal publica BTC/USDT 65000.01000000 con instante 2026-10-13T14:00:00.000Z y "W1" configura BTC/USDT
- **ENTONCES** "W1" registra BTC/USDT = 65000.01000000 tipo `MARKET`, origen proveedor, con ese provider y vigencia 2026-10-13T14:00:00.000Z

#### Scenario: Precio con más de 18 decimales
- **CUANDO** el provider cripto principal publica ETH/USDT 2450.1234567890123456789
- **ENTONCES** no se registra ninguna tasa de esa muestra y el estado del provider muestra la falla `PROVIDER_PAYLOAD_INVALID`

### Requirement: Histórico diario de precios cripto desde la primera fecha con saldo
Para cada par cripto configurado, el sistema DEBE (MUST) registrar en el workspace el precio de cierre diario publicado por el provider cripto como tasa `MARKET` con origen proveedor, vigente al cierre del día que publica el provider, desde la primera fecha en que el workspace tiene saldo en esa criptomoneda y solo para días completos; la carga DEBE (MUST) ser idempotente y DEBE (MUST) repetirse a diario para completar los días faltantes, incluidos los anteriores que aparecen si un movimiento con fecha pasada adelanta la primera fecha con saldo.
Trace: FR-FX-013, FR-REPORTING-006 · Priority: Must

#### Scenario: Backfill desde la primera fecha con saldo
- **CUANDO** hoy es 2026-10-13, "W1" configura BTC/USDT y su primer movimiento en BTC es del 2026-03-10
- **ENTONCES** se registran 217 tasas diarias BTC/USDT `MARKET`, del 2026-03-10 al 2026-10-12
- **Y** el cierre del 2026-03-31 de 82000.00 USDT se registra con vigencia 2026-03-31T23:59:59Z y el día en curso no se registra

#### Scenario: Recarga idempotente
- **CUANDO** la carga del histórico de BTC/USDT se ejecuta otra vez con los mismos cierres
- **ENTONCES** no se registra ninguna tasa nueva

#### Scenario: Movimiento con fecha anterior
- **CUANDO** después se registra un movimiento en BTC con fecha 2026-03-01
- **ENTONCES** el relleno diario registra los 9 cierres del 2026-03-01 al 2026-03-09
- **Y** no altera los cierres ya registrados

### Requirement: Providers habilitados solo con términos verificados
La configuración de providers NO DEBE (MUST NOT) aceptar un provider cuya verificación de términos de uso y licencia no esté registrada en la documentación de decisiones del proyecto con su fecha, su resultado y la atribución que exige; un provider con la verificación registrada como no apta NO DEBE (MUST NOT) habilitarse. Una configuración inválida DEBE (MUST) dejar los providers afectados deshabilitados con el error de configuración sin detener el resto del sistema.
Trace: NFR-COMP-007, FR-FX-015 · Priority: Must

#### Scenario: Provider sin verificación registrada
- **CUANDO** se configura como provider cripto principal una fuente que no tiene verificación de términos registrada
- **ENTONCES** los providers cripto no se inician y su estado informa `FX_PROVIDER_CONFIG_INVALID`
- **Y** los providers de tasa paralela y el resto del sistema siguen funcionando

## MODIFIED Requirements

### Requirement: Selección de la tasa de valoración con fallback entre providers
Para valorar un par con un tipo alimentado por providers (`PARALLEL`, `OFFICIAL` o `MARKET`) a un instante, el sistema DEBE (MUST) usar la tasa vigente no obsoleta del provider principal de ese tipo; si el principal falló o su última tasa está obsoleta (por defecto más de 60 minutos de antigüedad para `PARALLEL` y `MARKET` y más de 48 horas para `OFFICIAL`, configurable), DEBE (MUST) usar la tasa vigente no obsoleta del provider de respaldo, que tiene su propio umbral de obsolescencia configurable (por defecto 180 minutos para `PARALLEL`, porque bo.dolarapi.com publica su vigencia con unas 2 horas de retraso, y 60 minutos para `MARKET`); la valoración DEBE (MUST) informar el provider, la vigencia, la antigüedad y el nivel de fallback usados.
Trace: FR-FX-010, FR-FX-006 · Priority: Must

#### Scenario: Principal disponible
- **CUANDO** la última tasa `PARALLEL` USD/BOB de paralelo.bo es 12.02 con vigencia 2026-10-02T08:53:07.532Z y se valoran 100.00 USD a las 2026-10-02T09:00:00Z
- **ENTONCES** el resultado es 1202.00 BOB
- **Y** se informa la tasa 12.02 de paralelo.bo con antigüedad de 6 minutos y nivel principal

#### Scenario: Principal caído
- **CUANDO** paralelo.bo responde error desde las 09:15Z, su última tasa es del 2026-10-02T08:53:07.532Z y bo.dolarapi.com dio 12.055 a las 2026-10-02T09:50:00Z
- **Y** se valoran 100.00 USD a las 2026-10-02T10:00:00Z
- **ENTONCES** el resultado es 1205.50 BOB con la tasa 12.055 de bo.dolarapi.com y nivel respaldo

#### Scenario: Principal obsoleto aunque responda
- **CUANDO** paralelo.bo responde sin error pero repite el `timestamp` 2026-10-02T07:40:00Z hasta las 09:00:00Z
- **ENTONCES** su tasa se considera obsoleta (80 minutos)
- **Y** la valoración usa la tasa no obsoleta de bo.dolarapi.com

#### Scenario: Respaldo con retraso de publicación
- **CUANDO** paralelo.bo falla desde las 09:00Z con última tasa de vigencia 2026-10-02T08:53:07.532Z y la última tasa de bo.dolarapi.com es 12.055 con vigencia 2026-10-02T09:01:00Z
- **Y** se valoran 100.00 USD a las 2026-10-02T11:00:00Z
- **ENTONCES** el resultado es 1205.50 BOB con la tasa de bo.dolarapi.com, nivel respaldo, no obsoleta y con antigüedad de 119 minutos
- **Y** a las 2026-10-02T12:30:00Z (209 minutos) la misma tasa se informa como última conocida obsoleta

#### Scenario: Precio cripto del respaldo
- **CUANDO** la última tasa `MARKET` BTC/USDT del provider cripto principal es 65000.00 con vigencia 2026-10-13T12:50:00Z y la del respaldo es 65100.00 con vigencia 2026-10-13T13:58:00Z
- **Y** se valoran 0.01000000 BTC en USDT a las 2026-10-13T14:00:00Z
- **ENTONCES** el resultado es 651.000000 USDT con la tasa 65100.00 del respaldo y nivel respaldo, porque la del principal tiene 70 minutos

### Requirement: Detección de tasas anómalas
Una muestra de provider cuya variación respecto de la tasa aceptada anterior del mismo provider, par y tipo supere el umbral de su clase de activo DEBE (MUST) registrarse marcada como anómala y NO DEBE (MUST NOT) usarse para valorar hasta que un miembro con permiso de edición la confirme; una anomalía rechazada NO DEBE (MUST NOT) usarse nunca, y la confirmación o el rechazo DEBEN (MUST) quedar en la auditoría. El umbral DEBE (MUST) ser configurable por clase: por defecto 5 % cuando la moneda base del par es fiat o una moneda estable (USDT) y 10 % cuando es una criptomoneda volátil.
Trace: FR-FX-010 · Priority: Must

#### Scenario: Salto anómalo retenido
- **CUANDO** la tasa aceptada anterior de paralelo.bo para USD/BOB es 12.02 y llega una muestra de 13.50
- **ENTONCES** la muestra se registra marcada como anómala con variación de +12.31 %
- **Y** la valoración sigue usando 12.02 mientras la anomalía no se confirme

#### Scenario: Anomalía confirmada
- **CUANDO** un miembro con permiso de edición confirma la muestra anómala de 13.50 con motivo "devaluación anunciada"
- **ENTONCES** 100.00 USD pasan a valorarse en 1350.00 BOB
- **Y** la auditoría registra quién confirmó, cuándo y con qué motivo

#### Scenario: Variación normal
- **CUANDO** la tasa aceptada anterior es 12.02 y llega una muestra de 12.10 (+0.67 %)
- **ENTONCES** la muestra se usa directamente sin requerir confirmación

#### Scenario: Variación de una moneda estable sobre su umbral
- **CUANDO** la tasa aceptada anterior de USDT/BOB es 12.02 y llega una muestra de 12.70 (+5.66 %)
- **ENTONCES** la muestra se registra marcada como anómala

#### Scenario: Variación de cripto volátil bajo su umbral
- **CUANDO** la tasa aceptada anterior de BTC/USDT del provider cripto principal es 65000.00 y llega una muestra de 70000.00 (+7.69 %)
- **ENTONCES** la muestra se usa directamente sin requerir confirmación

#### Scenario: Variación de cripto volátil sobre su umbral
- **CUANDO** la tasa aceptada anterior de BTC/USDT es 65000.00 y llega una muestra de 72000.00 (+10.77 %)
- **ENTONCES** la muestra se registra marcada como anómala y la valoración sigue usando 65000.00

### Requirement: Atribución visible de la fuente de la tasa
Toda respuesta y toda vista que muestre una tasa de provider, o un monto valorado con ella, DEBE (MUST) incluir la atribución de su fuente: para paralelo.bo el texto "Fuente: paralelo.bo" con enlace a https://paralelo.bo y la licencia CC BY 4.0; para bo.dolarapi.com el texto "Fuente: bo.dolarapi.com" con enlace a https://bo.dolarapi.com; para cada provider de precios cripto, el texto, el enlace y la licencia que exijan sus términos según su verificación registrada. Un monto valorado con una tasa cruzada DEBE (MUST) incluir la atribución de cada tasa componente que provenga de un provider.
Trace: FR-FX-014, NFR-COMP-007 · Priority: Must

#### Scenario: Dinero disponible valorado con paralelo.bo
- **CUANDO** el dinero disponible se valora con USDT/BOB 12.02 de paralelo.bo
- **ENTONCES** junto a la tasa se muestra "Fuente: paralelo.bo" con enlace a https://paralelo.bo y la licencia CC BY 4.0

#### Scenario: Tasa manual sin atribución de provider
- **CUANDO** la tasa usada es manual con fuente descriptiva "Casa de cambio centro"
- **ENTONCES** se muestra "Casa de cambio centro" como fuente y ninguna atribución de provider

#### Scenario: Bitcoin valorado con una tasa cruzada
- **CUANDO** el patrimonio valora BTC en BOB con BTC/USDT del provider cripto principal y USDT/BOB de paralelo.bo
- **ENTONCES** se muestran la atribución registrada del provider cripto principal y "Fuente: paralelo.bo" con su licencia

### Requirement: Las consultas a providers no envían datos del usuario
Las solicitudes a providers NO DEBEN (MUST NOT) incluir datos del usuario ni del workspace (identificadores, montos, cuentas, saldos, monedas habilitadas, pares configurados, fechas de sus movimientos, ubicación, cookies ni credenciales) y DEBEN (MUST) ser solicitudes de solo lectura idénticas para cualquier workspace: los símbolos que se consultan a un provider cripto y los rangos de su histórico DEBEN (MUST) depender solo del catálogo global de monedas y de la configuración de la instalación, nunca de qué pares configuró cada workspace ni de sus fechas.
Trace: FR-FX-015, NFR-COMP-001 · Priority: Must

#### Scenario: Solicitud al provider principal
- **CUANDO** el proceso programado consulta paralelo.bo
- **ENTONCES** la solicitud es una lectura de https://paralelo.bo/api/v1/rate sin parámetros, sin cookies ni credenciales y con un agente de usuario genérico del producto
- **Y** no contiene identificadores de usuario ni de workspace, montos ni saldos

#### Scenario: Dos workspaces
- **CUANDO** existen dos workspaces con saldos distintos
- **ENTONCES** una única solicitud por provider y ciclo de consulta sirve a ambos

#### Scenario: Solicitudes cripto independientes de los pares configurados
- **CUANDO** "W1" configura solo BTC/USDT, "W2" configura solo ETH/USDT y el catálogo global tiene BTC y ETH
- **ENTONCES** las solicitudes al provider cripto en un ciclo son las mismas que si ningún workspace configurara pares cripto
- **Y** el histórico se pide con rangos fijados por la instalación, sin la fecha del primer movimiento de ningún workspace

### Requirement: Estado de los providers consultable
Un miembro del workspace DEBE (MUST) poder consultar el estado de cada provider: rol, pares y tipos, si está habilitado, último intento, último éxito, último error, fallas consecutivas, vigencia y antigüedad de su última tasa, si está obsoleta, próximo intento, estado de la carga histórica y su atribución; y, para cada par configurado del workspace, los providers que lo cubren, la antigüedad de su última tasa automática y si está cubierto solo por tasas manuales.
Trace: FR-FX-016 · Priority: Should

#### Scenario: Principal con fallas recientes
- **CUANDO** paralelo.bo tuvo éxito a las 2026-10-02T09:00:00Z con la muestra de vigencia 08:53:07.532Z y falló a las 09:15, 09:30 y 09:45
- **Y** se consulta el estado a las 09:45:30Z
- **ENTONCES** paralelo.bo figura como principal, degradado, con 3 fallas consecutivas, último éxito 09:00:00Z y última tasa de 52 minutos de antigüedad no obsoleta

#### Scenario: Providers deshabilitados
- **CUANDO** los providers están deshabilitados por configuración
- **ENTONCES** el estado los muestra como deshabilitados sin intentos programados

#### Scenario: Pares configurados en el estado
- **CUANDO** "W1" configura USDT/BOB, BTC/USDT y EUR/BOB y se consulta el estado a las 2026-10-13T14:05:00Z
- **ENTONCES** USDT/BOB figura cubierto por paralelo.bo y bo.dolarapi.com, BTC/USDT por los providers cripto principal y de respaldo con la antigüedad de su última tasa, y EUR/BOB cubierto solo por tasas manuales
