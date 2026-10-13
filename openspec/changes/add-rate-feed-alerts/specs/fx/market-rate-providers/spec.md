## ADDED Requirements

### Requirement: Episodios de obsolescencia por par configurado
Para cada workspace y cada par configurado que algún provider habilitado publica, el sistema DEBE (MUST) abrir un episodio de obsolescencia cuando el par lleva más de N horas (por defecto 6, configurable) sin una tasa aceptada de ningún provider en el tipo automático del par (`PARALLEL` para fiat y estables, `MARKET` para cripto volátil), contadas desde la vigencia de su última tasa aceptada; DEBE (MUST) publicar un único hecho de obsolescencia por episodio aunque la verificación se repita, y DEBE (MUST) cerrar el episodio y publicar un único hecho de recuperación cuando llega una tasa aceptada con antigüedad menor o igual a N horas. Las tasas manuales y las muestras retenidas o rechazadas NO DEBEN (MUST NOT) contar como tasa fresca. La verificación DEBE (MUST) hacerse en el mismo proceso programado de los providers, y con todos los providers deshabilitados NO DEBE (MUST NOT) abrirse ningún episodio.
Trace: FR-FX-010, FR-FX-016, FR-NOTIFY-005 · Priority: Must

#### Scenario: Par sin tasa fresca por más de 6 horas
- **CUANDO** "W1" configura USDT/BOB, paralelo.bo y bo.dolarapi.com fallan desde las 2026-10-13T08:10:00Z y la última tasa `PARALLEL` USDT/BOB aceptada tiene vigencia 2026-10-13T08:00:00Z
- **Y** el ciclo de las 2026-10-13T14:15:00Z verifica los pares
- **ENTONCES** se abre un episodio de obsolescencia de USDT/BOB en "W1" desde la vigencia 2026-10-13T08:00:00Z y se publica un hecho de obsolescencia

#### Scenario: Verificación repetida durante el episodio
- **CUANDO** los ciclos de las 14:30Z, 14:45Z y 15:00Z siguen sin tasa fresca de USDT/BOB
- **ENTONCES** no se abre otro episodio ni se publica otro hecho de obsolescencia

#### Scenario: Recuperación del par
- **CUANDO** a las 2026-10-13T16:00:00Z paralelo.bo vuelve a publicar USDT/BOB 12.05 con vigencia 2026-10-13T15:58:00Z
- **ENTONCES** el episodio se cierra y se publica un único hecho de recuperación con la nueva vigencia
- **Y** si más tarde el par vuelve a pasar 6 horas sin tasa fresca, se abre un episodio nuevo

#### Scenario: Tasa manual no evita el episodio
- **CUANDO** durante la caída el EDITOR registra USDT/BOB `P2P` 12.00 manual
- **ENTONCES** el episodio de obsolescencia sigue abierto porque ningún provider publicó una tasa fresca

#### Scenario: Par cubierto solo por tasas manuales
- **CUANDO** "W1" configura EUR/BOB y ningún provider habilitado publica EUR/BOB
- **ENTONCES** nunca se abre un episodio de obsolescencia de EUR/BOB

#### Scenario: Providers deshabilitados
- **CUANDO** todos los providers están deshabilitados por configuración
- **ENTONCES** no se abre ningún episodio de obsolescencia en ningún workspace

### Requirement: Hecho publicado por cada muestra retenida como anómala
Cuando una muestra de provider se registra marcada como anómala en un workspace, el sistema DEBE (MUST) publicar un único hecho de muestra retenida para esa tasa con el par, el provider, el valor, la línea base y la variación; la muestra DEBE (MUST) seguir retenida y sin usarse para valorar hasta que un miembro con permiso de edición la confirme o la rechace, sin plazo de aceptación automática.
Trace: FR-FX-010, FR-NOTIFY-005 · Priority: Should

#### Scenario: Muestra de bitcoin retenida
- **CUANDO** la tasa aceptada anterior de BTC/USDT del provider cripto principal en "W1" es 65000.00 y llega una muestra de 72000.00 (+10.77 %)
- **ENTONCES** se publica un único hecho de muestra retenida de BTC/USDT con valor 72000.00, línea base 65000.00 y variación +10.77 %
- **Y** la valoración sigue usando 65000.00

#### Scenario: Muestra retenida durante días
- **CUANDO** nadie confirma ni rechaza esa muestra durante 3 días
- **ENTONCES** la muestra sigue retenida y no se publica un segundo hecho para ella
