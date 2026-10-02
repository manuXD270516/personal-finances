# Spec Delta

## Purpose

Obtiene automáticamente tasas de mercado para Bolivia (dólar paralelo "blue" y tasa oficial) desde providers externos intercambiables, las registra como tasas históricas inmutables con su procedencia, elige la tasa de valoración con fallback explícito entre providers y tasas manuales, detecta valores anómalos y obsoletos, respeta los términos y límites de cada fuente, muestra su atribución y garantiza que el core siga funcionando sin providers. Adelantado a Phase 1 por decisión del owner (docs/31 D29, ADR-0025).

## ADDED Requirements

### Requirement: Providers automáticos de tasa paralela y oficial
El sistema DEBE (MUST) obtener tasas de mercado mediante providers intercambiables configurados por rol: un provider principal de tasa paralela (paralelo.bo, tipo `PARALLEL`, pares USD/BOB y USDT/BOB, valor = mediana publicada) y un provider de respaldo (bo.dolarapi.com) que aporta la tasa `PARALLEL` de Binance P2P para USD/BOB y USDT/BOB (valor = punto medio entre compra y venta) y la tasa `OFFICIAL` USD/BOB; cada tasa registrada DEBE (MUST) identificar el provider que la originó.
Trace: FR-FX-009 · Priority: Must

#### Scenario: Muestra del provider principal
- **CUANDO** paralelo.bo responde `timestamp` 2026-10-02T08:53:07.532Z, `buy` 12.12, `sell` 11.92, `median` 12.02 y `sourceCount` 4
- **ENTONCES** se registran USD/BOB = 12.02 y USDT/BOB = 12.02, tipo `PARALLEL`, origen proveedor, provider paralelo.bo y vigencia 2026-10-02T08:53:07.532Z
- **Y** la compra 12.12 y la venta 11.92 quedan en la respuesta cruda conservada, no como valor de la tasa

#### Scenario: Muestra del provider de respaldo
- **CUANDO** bo.dolarapi.com responde la casa `oficial` con compra 12 y venta 12 actualizada el 2026-10-01T00:00:00.000Z y la casa `binance` con compra 12.04 y venta 12.07
- **ENTONCES** se registra USD/BOB = 12 tipo `OFFICIAL` con provider bo.dolarapi.com y vigencia 2026-10-01T00:00:00.000Z
- **Y** se registran USD/BOB = 12.055 y USDT/BOB = 12.055 tipo `PARALLEL` con provider bo.dolarapi.com

### Requirement: Lectura exacta de los valores publicados por los providers
El sistema DEBE (MUST) leer cada valor numérico de la respuesta de un provider como decimal exacto a partir de su representación textual, sin pasar por punto flotante binario; una muestra con un valor ausente, no numérico, menor o igual a cero o con más de 18 decimales NO DEBE (MUST NOT) registrarse y DEBE (MUST) contarse como falla del provider.
Trace: FR-FX-009, NFR-DATA-001 · Priority: Must

#### Scenario: Valor con 18 decimales
- **CUANDO** paralelo.bo responde `median` 12.020000000000000001
- **ENTONCES** la tasa se registra con el valor exacto "12.020000000000000001"
- **Y** no como "12.02", que resultaría de leerla como número de punto flotante

#### Scenario: Valor ausente
- **CUANDO** paralelo.bo responde `median` nulo
- **ENTONCES** no se registra ninguna tasa de esa muestra
- **Y** el estado del provider muestra la falla `PROVIDER_PAYLOAD_INVALID`

### Requirement: Registro periódico de tasas de provider como históricas inmutables
Un proceso programado DEBE (MUST) consultar los providers con un intervalo configurable (por defecto cada 15 minutos) y registrar cada muestra nueva como tasa histórica inmutable con origen proveedor, provider, instante publicado por el provider como vigencia, instante de obtención y la respuesta cruda; una muestra con el mismo provider, par, tipo y vigencia ya registrada NO DEBE (MUST NOT) registrarse de nuevo, y ninguna tasa registrada DEBE (MUST) modificarse después.
Trace: FR-FX-009, FR-FX-003, NFR-DATA-006 · Priority: Must

#### Scenario: Muestra nueva registrada
- **CUANDO** la consulta de las 2026-10-02T09:00:00Z obtiene de paralelo.bo la mediana 12.02 con `timestamp` 2026-10-02T08:53:07.532Z
- **ENTONCES** se registra USD/BOB `PARALLEL` 12.02 con vigencia 2026-10-02T08:53:07.532Z, obtenida a las 09:00:00Z y con la respuesta cruda completa
- **Y** leerla más tarde por su identificador devuelve siempre 12.02

#### Scenario: Muestra repetida no se duplica
- **CUANDO** la consulta de las 2026-10-02T09:15:00Z recibe otra vez el `timestamp` 2026-10-02T08:53:07.532Z
- **ENTONCES** no se registra ninguna tasa nueva
- **Y** el estado del provider registra el intento exitoso de las 09:15:00Z sin muestra nueva

#### Scenario: Intervalo configurado
- **CUANDO** el intervalo de consulta se configura en 30 minutos
- **ENTONCES** las consultas ocurren cada 30 minutos en lugar de cada 15

### Requirement: Carga inicial del histórico diario de la tasa paralela
Al configurarse un workspace, el sistema DEBE (MUST) importar el histórico diario de la tasa paralela del provider principal como tasas `PARALLEL` USD/BOB y USDT/BOB con origen proveedor, vigentes al cierre de cada día en America/La_Paz y solo para días completos; la importación DEBE (MUST) ser idempotente y DEBE (MUST) repetirse a diario para rellenar los días sin tasa del provider.
Trace: FR-FX-013 · Priority: Must

#### Scenario: Histórico completo
- **CUANDO** el 2026-10-02 el histórico de paralelo.bo contiene 788 puntos diarios desde 2024-08-06 hasta 2026-10-02, entre ellos el punto del 2026-09-10 con valor 11.96
- **ENTONCES** se registran 787 tasas diarias `PARALLEL` por cada par USD/BOB y USDT/BOB, hasta el 2026-10-01
- **Y** el punto del día en curso 2026-10-02 no se registra
- **Y** USD/BOB del 2026-09-10 vale 11.96 con vigencia 2026-09-10T23:59:59-04:00

#### Scenario: Reimportación idempotente
- **CUANDO** la importación del histórico se ejecuta otra vez con los mismos puntos
- **ENTONCES** no se registra ninguna tasa nueva

#### Scenario: Relleno de días sin tasa
- **CUANDO** los providers estuvieron inaccesibles del 2026-09-20 al 2026-09-22 y el histórico publica esos tres días
- **ENTONCES** el relleno diario registra las tres tasas diarias faltantes por par
- **Y** no altera las tasas de los días que ya tenían muestras

### Requirement: Selección de la tasa de valoración con fallback entre providers
Para valorar un par con tipo `PARALLEL` a un instante, el sistema DEBE (MUST) usar la tasa vigente no obsoleta del provider principal; si el principal falló o su última tasa está obsoleta (por defecto más de 60 minutos de antigüedad para `PARALLEL` y más de 48 horas para `OFFICIAL`, configurable), DEBE (MUST) usar la tasa vigente no obsoleta del provider de respaldo; la valoración DEBE (MUST) informar el provider, la vigencia, la antigüedad y el nivel de fallback usados.
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

### Requirement: Última tasa conocida marcada como obsoleta
Si ningún provider tiene una tasa no obsoleta del par, el sistema DEBE (MUST) usar la tasa más reciente dentro de la ventana de vigencia (por defecto 7 días) entre la última de provider y la última manual del par; si se usa la de provider, DEBE (MUST) marcarse como obsoleta con su antigüedad; si no hay ninguna tasa en la ventana, DEBE (MUST) responder `FX_RATE_NOT_FOUND` y NO DEBE (MUST NOT) inventar un valor.
Trace: FR-FX-010, FR-FX-004 · Priority: Must

#### Scenario: Ambos providers caídos
- **CUANDO** ambos providers fallan desde las 09:00Z, la última tasa conocida es 12.02 de paralelo.bo con vigencia 2026-10-02T08:53:07.532Z y no hay tasas manuales posteriores
- **Y** se valoran 100.00 USD a las 2026-10-02T14:53:07.532Z
- **ENTONCES** el resultado es 1202.00 BOB marcado como obsoleto con antigüedad de 6 horas

#### Scenario: Tasa manual más reciente que la de provider
- **CUANDO** ambos providers fallan desde las 09:00Z y el usuario registra a las 2026-10-02T13:00:00Z la tasa manual USD/BOB `PARALLEL` 12.10
- **Y** se valoran 100.00 USD a las 2026-10-02T14:00:00Z
- **ENTONCES** el resultado es 1210.00 BOB con la tasa manual 12.10 y origen manual

#### Scenario: Sin tasa dentro de la ventana
- **CUANDO** la última tasa USD/BOB de cualquier origen es del 2026-09-20 y se valora al 2026-10-02
- **ENTONCES** la consulta responde `FX_RATE_NOT_FOUND`

### Requirement: Las tasas manuales prevalecen para operaciones concretas
Los providers NO DEBEN (MUST NOT) modificar, reemplazar ni ocultar tasas manuales; el usuario DEBE (MUST) poder registrar tasas manuales en todo momento, y la tasa manual que el usuario indica como referencia de una operación concreta DEBE (MUST) quedar registrada como referencia de esa operación aunque exista una tasa de provider más reciente.
Trace: FR-FX-010, FR-FX-008, FR-FX-002 · Priority: Must

#### Scenario: Conversión con tasa manual indicada
- **CUANDO** existe USDT/BOB `PARALLEL` 12.02 de paralelo.bo con vigencia 2026-10-02T08:53:07.532Z
- **Y** el usuario registra la tasa manual USDT/BOB `P2P` 11.98 a las 2026-10-02T09:10:00Z y la indica como referencia de la conversión de 100.000000 USDT a 1198.00 BOB ejecutada a las 09:12:00Z
- **ENTONCES** la referencia registrada de la conversión es la tasa manual 11.98 con su identificador
- **Y** la tasa 12.02 del provider no se usa como referencia de esa conversión

#### Scenario: El provider no toca tasas manuales
- **CUANDO** existe la tasa manual USD/BOB `PARALLEL` 12.10 y luego se registra la tasa 12.02 de paralelo.bo
- **ENTONCES** la tasa manual sigue leyéndose con valor 12.10 y sin reemplazo

### Requirement: Detección de tasas anómalas
Una muestra de provider cuya variación respecto de la tasa aceptada anterior del mismo provider, par y tipo supere un umbral configurable (por defecto 5 %) DEBE (MUST) registrarse marcada como anómala y NO DEBE (MUST NOT) usarse para valorar hasta que un miembro con permiso de edición la confirme; una anomalía rechazada NO DEBE (MUST NOT) usarse nunca, y la confirmación o el rechazo DEBEN (MUST) quedar en la auditoría.
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

### Requirement: Respeto de los límites de uso y la caché de los providers
El sistema DEBE (MUST) respetar los límites publicados de cada provider: no superar su límite de solicitudes (paralelo.bo: 60 por minuto), no repetir una solicitud mientras su respuesta siga vigente según la caché declarada por el provider, esperar el tiempo indicado ante una respuesta de límite excedido antes de volver a consultarlo, y NO DEBE (MUST NOT) aceptar un intervalo de consulta menor a 60 segundos.
Trace: FR-FX-017, NFR-COMP-007 · Priority: Must

#### Scenario: Límite excedido
- **CUANDO** paralelo.bo responde a las 2026-10-02T09:00:00Z límite excedido con espera indicada de 120 segundos
- **ENTONCES** no se envía otra solicitud a paralelo.bo antes de las 09:02:00Z
- **Y** mientras tanto la valoración aplica el fallback

#### Scenario: Respuesta en caché vigente
- **CUANDO** una consulta exitosa a paralelo.bo de las 09:00:00Z declaró caché de 60 segundos y se solicita otra consulta a las 09:00:30Z
- **ENTONCES** se reutiliza la respuesta anterior sin enviar una solicitud nueva

#### Scenario: Intervalo demasiado corto
- **CUANDO** se configura un intervalo de consulta de 30 segundos
- **ENTONCES** los providers no se inician y se informa el error de configuración
- **Y** el resto del sistema sigue funcionando

### Requirement: Atribución visible de la fuente de la tasa
Toda respuesta y toda vista que muestre una tasa de provider, o un monto valorado con ella, DEBE (MUST) incluir la atribución de su fuente: para paralelo.bo el texto "Fuente: paralelo.bo" con enlace a https://paralelo.bo y la licencia CC BY 4.0; para bo.dolarapi.com el texto "Fuente: bo.dolarapi.com" con enlace a https://bo.dolarapi.com.
Trace: FR-FX-014, NFR-COMP-007 · Priority: Must

#### Scenario: Dinero disponible valorado con paralelo.bo
- **CUANDO** el dinero disponible se valora con USDT/BOB 12.02 de paralelo.bo
- **ENTONCES** junto a la tasa se muestra "Fuente: paralelo.bo" con enlace a https://paralelo.bo y la licencia CC BY 4.0

#### Scenario: Tasa manual sin atribución de provider
- **CUANDO** la tasa usada es manual con fuente descriptiva "Casa de cambio centro"
- **ENTONCES** se muestra "Casa de cambio centro" como fuente y ninguna atribución de provider

### Requirement: Las consultas a providers no envían datos del usuario
Las solicitudes a providers NO DEBEN (MUST NOT) incluir datos del usuario ni del workspace (identificadores, montos, cuentas, saldos, monedas habilitadas, ubicación, cookies ni credenciales) y DEBEN (MUST) ser solicitudes de solo lectura idénticas para cualquier workspace.
Trace: FR-FX-015, NFR-COMP-001 · Priority: Must

#### Scenario: Solicitud al provider principal
- **CUANDO** el proceso programado consulta paralelo.bo
- **ENTONCES** la solicitud es una lectura de https://paralelo.bo/api/v1/rate sin parámetros, sin cookies ni credenciales y con un agente de usuario genérico del producto
- **Y** no contiene identificadores de usuario ni de workspace, montos ni saldos

#### Scenario: Dos workspaces
- **CUANDO** existen dos workspaces con saldos distintos
- **ENTONCES** una única solicitud por provider y ciclo de consulta sirve a ambos

### Requirement: Funcionamiento sin providers
El core DEBE (MUST) funcionar con los providers deshabilitados o inalcanzables: registrar tasas manuales, registrar conversiones, valorar con tasas manuales y mostrar el dashboard; ninguna solicitud del usuario DEBE (MUST) consultar a un provider de forma síncrona ni fallar por la falla de un provider.
Trace: FR-FX-015 · Priority: Must

#### Scenario: Providers deshabilitados
- **CUANDO** los providers principal y de respaldo están deshabilitados por configuración
- **Y** el usuario registra la tasa manual USDT/BOB `P2P` 11.98 y consulta el dinero disponible con 50.000000 USDT
- **ENTONCES** los 50.000000 USDT se valoran en 599.00 BOB con la tasa manual
- **Y** no se envía ninguna solicitud externa

#### Scenario: Provider lento durante una consulta del usuario
- **CUANDO** paralelo.bo tarda más de 30 segundos en responder mientras el usuario consulta el resumen
- **ENTONCES** el resumen responde con las tasas ya registradas sin esperar al provider

### Requirement: Estado de los providers consultable
Un miembro del workspace DEBE (MUST) poder consultar el estado de cada provider: rol, pares y tipos, si está habilitado, último intento, último éxito, último error, fallas consecutivas, vigencia y antigüedad de su última tasa, si está obsoleta, próximo intento, estado de la carga histórica y su atribución.
Trace: FR-FX-016 · Priority: Should

#### Scenario: Principal con fallas recientes
- **CUANDO** paralelo.bo tuvo éxito a las 2026-10-02T09:00:00Z con la muestra de vigencia 08:53:07.532Z y falló a las 09:15, 09:30 y 09:45
- **Y** se consulta el estado a las 09:45:30Z
- **ENTONCES** paralelo.bo figura como principal, degradado, con 3 fallas consecutivas, último éxito 09:00:00Z y última tasa de 52 minutos de antigüedad no obsoleta

#### Scenario: Providers deshabilitados
- **CUANDO** los providers están deshabilitados por configuración
- **ENTONCES** el estado los muestra como deshabilitados sin intentos programados
