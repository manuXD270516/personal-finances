# platform/local-environment Specification

## Purpose
Permite que cualquier desarrollador clone el repositorio y ejecute el producto completo, o solo las partes que necesita, mediante contenedores y con un conjunto mínimo y reproducible de comandos en Windows, macOS o Linux.

## Requirements

### Requirement: Stack local con un solo comando
El proyecto DEBE (MUST) proveer un comando documentado que levante localmente el producto completo (web, API, worker y todas sus dependencias) usando solo contenedores, sin instalar en el host nada más que el runtime de contenedores, Node.js y el gestor de paquetes.
Trace: NFR-PORT-001, NFR-PORT-002, NFR-PORT-003 · Priority: Must

#### Scenario: Clon limpio levanta el stack completo
- **CUANDO** un desarrollador en una máquina limpia clona el repositorio, copia el archivo de entorno de ejemplo y ejecuta el comando documentado para el perfil core
- **ENTONCES** todos los servicios core alcanzan el estado healthy sin pasos manuales
- **Y** la UI web y el endpoint de salud de la API responden en sus puertos documentados

### Requirement: Perfiles seleccionables del stack
El stack local DEBE (MUST) organizarse en perfiles para que el desarrollador levante solo lo necesario: `deps` (almacenes de datos, proveedor de identidad, capturador de correo), `core` (deps más web, API y worker), `seed`, `observability` y `ml`.
Trace: NFR-PORT-001 · Priority: Must

#### Scenario: Solo dependencias
- **CUANDO** el desarrollador levanta el perfil `deps`
- **ENTONCES** solo arrancan los servicios de dependencias y quedan healthy
- **Y** no se inicia ningún contenedor de aplicación

#### Scenario: Observabilidad opcional
- **CUANDO** el desarrollador levanta `core` junto con `observability`
- **ENTONCES** la telemetría de la API y del worker es visible en la UI local de telemetría
- **Y** levantar `core` solo no inicia ningún servicio de telemetría

### Requirement: Arranque ordenado por salud
Los servicios de aplicación DEBEN (MUST) arrancar solo cuando sus dependencias críticas estén healthy, y las migraciones de base de datos DEBEN (MUST) completarse con éxito antes de que arranquen la API y el worker.
Trace: NFR-REL-011 · Priority: Must

#### Scenario: Las migraciones condicionan a la API
- **CUANDO** se levanta el perfil core y el job de migración falla
- **ENTONCES** los contenedores de API y worker no se inician
- **Y** el fallo de migración es visible en la salida del comando de logs

### Requirement: Configuración por entorno sin secretos en el repositorio
Toda la configuración de servicios DEBE (MUST) provenir de variables de entorno documentadas en un archivo de ejemplo versionado que no contenga secretos reales, y las direcciones de servicios DEBEN (MUST) resolverse por configuración y no por hostnames fijos en el código.
Trace: NFR-SEC-007, NFR-PORT-005 · Priority: Must

#### Scenario: El archivo de ejemplo no contiene secretos
- **CUANDO** el escáner de secretos recorre el repositorio
- **ENTONCES** no reporta hallazgos en el archivo de entorno de ejemplo, los archivos de build de contenedores ni los archivos de compose

#### Scenario: Sin localhost fijo
- **CUANDO** se analiza el código de aplicación y las definiciones de contenedores buscando direcciones `localhost` o `127.0.0.1` fijas, fuera de documentación y fixtures de test
- **ENTONCES** no se encuentra ninguna ocurrencia

### Requirement: Datos locales persistentes y reiniciables
Los datos de base de datos y de object storage DEBEN (MUST) persistir entre reinicios del stack en volúmenes nombrados, y un comando documentado de reset DEBE (MUST) reconstruir un estado limpio: base vacía, migraciones aplicadas y seed seleccionado cargado.
Trace: NFR-PORT-001, NFR-REL-004 · Priority: Must

#### Scenario: Los datos sobreviven al reinicio
- **CUANDO** el desarrollador detiene y vuelve a levantar el stack
- **ENTONCES** los datos creados previamente siguen presentes

#### Scenario: Reset con seed
- **CUANDO** el desarrollador ejecuta el comando de reset con el perfil de seed `minimal`
- **ENTONCES** la base contiene exactamente el dataset del seed mínimo y todas las migraciones están aplicadas

### Requirement: Comandos operativos
El proyecto DEBE (MUST) proveer comandos multiplataforma para start, stop, restart, logs, reset, seed, test, integration-test, migrate, backup local y restore local, y estos NO DEBEN (MUST NOT) depender de un shell exclusivo de POSIX.
Trace: NFR-PORT-004 · Priority: Must

#### Scenario: Ida y vuelta de backup y restore
- **CUANDO** el desarrollador ejecuta el backup local, modifica datos y luego ejecuta el restore local con ese backup
- **ENTONCES** la base de datos y el object storage vuelven al estado respaldado

### Requirement: Apagado ordenado
Los contenedores de aplicación DEBEN (MUST) dejar de aceptar trabajo nuevo al recibir la señal de terminación y terminar o liberar de forma segura las peticiones y jobs en curso dentro del período de gracia configurado.
Trace: NFR-REL-009 · Priority: Must

#### Scenario: El worker se detiene a mitad de un job
- **CUANDO** el worker recibe una señal de terminación mientras procesa un job
- **ENTONCES** el job se completa o se devuelve a la cola para reintento
- **Y** ningún job queda marcado como completado sin que sus efectos estén confirmados

### Requirement: Stack de E2E servido por HTTPS con una autoridad de prueba efímera
El stack de la suite E2E DEBE (MUST) exponer por HTTPS, en la interfaz de loopback, todos los orígenes que usa el navegador: la aplicación web, el proveedor de identidad y la subida directa de archivos. El certificado DEBE (MUST) emitirlo una autoridad de prueba que se genera al levantar el stack y se destruye al bajarlo. NO DEBE (MUST NOT) versionarse ninguna clave privada ni certificado de esa autoridad, y ningún contenedor de la aplicación DEBE (MUST) necesitar confiar en ella. La cookie de sesión NO DEBE (MUST NOT) cambiar ningún atributo respecto de producción para funcionar en este stack.
Trace: NFR-USAB-005, NFR-SEC-001, NFR-SEC-008, NFR-PORT-001 · Priority: Should

#### Scenario: Orígenes públicos por HTTPS
- **CUANDO** el harness levanta el stack de E2E con `PF_E2E_PROJECT=pfos-e2e-<nombre>`
- **ENTONCES** la URL pública de la aplicación, la del proveedor de identidad y la de la subida de archivos usan el esquema `https` sobre `localhost`
- **Y** el inicio de sesión de la suite termina en la aplicación con una sesión válida

#### Scenario: Autoridad efímera sin secretos versionados
- **CUANDO** se levanta y después se baja con sus volúmenes el stack de E2E
- **ENTONCES** la autoridad y el certificado existen solo mientras el stack está arriba
- **Y** el repositorio no contiene ninguna clave privada ni certificado de esa autoridad

#### Scenario: Subida directa de archivos sin contenido mixto
- **CUANDO** un usuario de prueba sube un documento desde la aplicación servida por HTTPS
- **ENTONCES** la subida llega al almacenamiento por HTTPS
- **Y** el navegador no registra ningún bloqueo por contenido mixto ni violación de la política de seguridad de contenido

### Requirement: Aislamiento de la corrida E2E por proyecto y prefijo de puertos
El harness de E2E DEBE (MUST) levantar el stack solo en un proyecto de Compose cuyo nombre empiece por `pfos-e2e` y con un prefijo de puertos publicados de 3 o 4, aplicado también a los puertos HTTPS. Un nombre de proyecto o un prefijo fuera de ese conjunto DEBE (MUST) hacer fallar la corrida antes de crear, detener o borrar cualquier contenedor.
Trace: NFR-PORT-001, NFR-PORT-005 · Priority: Should

#### Scenario: Prefijo 3 aplicado a todos los puertos
- **CUANDO** se corre la suite con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y `PF_E2E_PORT_PREFIX=3`
- **ENTONCES** todos los puertos publicados del stack, incluidos los HTTPS, empiezan por 3

#### Scenario: Prefijo 5 rechazado antes de tocar Docker
- **CUANDO** se corre la suite con `PF_E2E_PORT_PREFIX=5`
- **ENTONCES** la corrida falla con un mensaje que nombra la variable y los valores permitidos
- **Y** no se crea, detiene ni borra ningún contenedor

### Requirement: El stack de desarrollo sigue por http salvo que se pida TLS
El stack de desarrollo DEBE (MUST) seguir sirviendo sus orígenes públicos por `http` cuando no se pide el perfil de TLS. El proxy TLS DEBE (MUST) levantarse solo cuando se activa ese perfil.
Trace: NFR-PORT-001 · Priority: Should

#### Scenario: Stack de desarrollo sin el perfil de TLS
- **CUANDO** se levanta el stack con los perfiles por omisión y sin el de TLS
- **ENTONCES** la aplicación responde en su URL `http` de siempre
- **Y** no existe ningún contenedor del proxy TLS

### Requirement: Protección del stack de desarrollo del owner
Los comandos `pnpm stack:*` y `pnpm restore:local` DEBEN (MUST) tomar el proyecto Compose de `PF_COMPOSE_PROJECT` o, si no existe, de `PF_E2E_PROJECT`, y usar `pfos` solo cuando ninguna está definida; `PF_E2E_PROJECT` DEBE (MUST) empezar con `pfos-e2e` y, si se definen ambas con valores distintos, el comando DEBE (MUST) fallar. Toda operación que borre datos (`stack:down --volumes`, `stack:reset`, `restore:local`) sobre el proyecto `pfos` DEBE (MUST) negarse cuando no hay terminal interactiva, aunque se pase `--yes`, salvo que `PF_ALLOW_DEV_STACK_WIPE=pfos` esté definida, y el mensaje de error DEBE (MUST) explicar el motivo.
Trace: NFR-PORT-001 · Priority: Must

#### Scenario: PF_E2E_PROJECT elige el proyecto
- **CUANDO** se ejecuta un comando `stack` con `PF_E2E_PROJECT=pfos-e2e-pwa` y sin `PF_COMPOSE_PROJECT`
- **ENTONCES** opera sobre el proyecto `pfos-e2e-pwa` y no sobre `pfos`

#### Scenario: Variables contradictorias o fuera de convención
- **CUANDO** `PF_E2E_PROJECT` no empieza con `pfos-e2e`, o `PF_COMPOSE_PROJECT` y `PF_E2E_PROJECT` difieren
- **ENTONCES** el comando falla antes de invocar Docker

#### Scenario: Borrado sobre pfos sin terminal
- **CUANDO** se ejecuta `stack:down --volumes --yes` (o `stack:reset`, o `restore:local`) sobre `pfos` sin terminal interactiva y sin `PF_ALLOW_DEV_STACK_WIPE=pfos`
- **ENTONCES** el comando se niega con un mensaje que explica el motivo y no invoca Docker

#### Scenario: Terminal interactiva o proyecto desechable
- **CUANDO** el owner ejecuta la operación en una terminal interactiva, o el proyecto es distinto de `pfos`
- **ENTONCES** el comportamiento no cambia (confirmación interactiva o `--yes`)
