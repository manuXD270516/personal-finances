## ADDED Requirements

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
