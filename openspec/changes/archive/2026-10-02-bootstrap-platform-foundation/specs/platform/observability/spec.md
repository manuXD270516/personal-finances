# Spec Delta

## Purpose

Define la visibilidad operativa mínima que todo desplegable debe ofrecer desde el primer día: probes de salud confiables para el orquestador y logs estructurados y correlacionados.

## ADDED Requirements

### Requirement: Endpoint de liveness
Todo contenedor de aplicación HTTP DEBE (MUST) exponer un endpoint de liveness que informe si el proceso está vivo, sin verificar dependencias externas.
Trace: NFR-REL-011 · Priority: Must

#### Scenario: Liveness independiente de la base de datos
- **CUANDO** la base de datos no es alcanzable
- **ENTONCES** el endpoint de liveness sigue respondiendo éxito

### Requirement: Readiness refleja dependencias críticas
Todo contenedor de aplicación HTTP DEBE (MUST) exponer un endpoint de readiness que solo informe listo cuando sus dependencias críticas (base de datos, cache/cola, object storage) sean alcanzables.
Trace: NFR-REL-011 · Priority: Must

#### Scenario: API no lista sin base de datos
- **CUANDO** la base de datos no es alcanzable
- **ENTONCES** el endpoint de readiness de la API responde no-listo indicando en el cuerpo la dependencia que falla
- **Y** el contenedor no se reporta healthy

### Requirement: Logs estructurados y correlacionados
Los logs de aplicación DEBEN (MUST) ser líneas JSON estructuradas con timestamp, nivel, servicio, entorno y un identificador de correlación compartido por todas las líneas de la misma petición o job, y NO DEBEN (MUST NOT) incluir credenciales, tokens ni contenido de documentos.
Trace: NFR-OBS-001, NFR-SEC-015 · Priority: Must

#### Scenario: Correlación de una petición
- **CUANDO** la API procesa una petición que dispara un job asíncrono en el worker
- **ENTONCES** las líneas de log de ambos procesos llevan el mismo identificador de correlación

#### Scenario: Datos sensibles excluidos
- **CUANDO** se registra una petición que trae un header de autorización
- **ENTONCES** la entrada de log no contiene el valor del token
