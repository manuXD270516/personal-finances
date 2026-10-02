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
