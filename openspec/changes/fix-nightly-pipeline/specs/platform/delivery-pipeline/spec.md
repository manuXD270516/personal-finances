## ADDED Requirements

### Requirement: Financial Regression Suite con el contexto de ejecución del gate
El pipeline programado DEBE (MUST) ejecutar completo y en su orden cada archivo de test que contiene un test case de la Financial Regression Suite, igual que el gate de pull request, y NO DEBE (MUST NOT) filtrar los tests de un archivo por su nombre. El fallo de cualquier test de esos archivos, nombre o no un test case, DEBE (MUST) hacer fallar su grupo y la corrida, y el reporte DEBE (MUST) indicar por grupo los archivos ejecutados y su resultado.
Trace: NFR-MAINT-005, NFR-MAINT-007 · Priority: Must

#### Scenario: Un test case que necesita el estado de un test anterior del mismo archivo
- **CUANDO** un archivo de integración contiene primero un test que crea los periodos "2026-10" a "2027-01" de un workspace y después un test case de la suite que intenta insertar un periodo "2026-10" solapado en ese workspace
- **ENTONCES** el pipeline programado ejecuta ambos tests en ese orden
- **Y** el test case de la suite obtiene el rechazo por solapamiento, el mismo resultado que en el gate de pull request

#### Scenario: Falla un test sin test case dentro de un archivo de la suite
- **CUANDO** en un archivo de la suite falla un test cuyo nombre no contiene ningún identificador de test case
- **ENTONCES** el grupo de ese archivo queda en rojo y la corrida del pipeline programado falla
- **Y** el reporte indica el paquete y el archivo del grupo fallido

#### Scenario: El comando de un grupo no filtra por nombre
- **CUANDO** el ejecutor arma el comando de un grupo de tests unitarios o de integración de la suite
- **ENTONCES** el comando nombra los archivos del grupo y no incluye ningún patrón de filtro por nombre de test

### Requirement: Cobertura del núcleo compartido sin rebajar umbrales
El pipeline programado DEBE (MUST) medir la cobertura del núcleo compartido solo con sus propios tests y fallar si queda por debajo de 95 % de líneas o de 90 % de ramas. Esos umbrales NO DEBEN (MUST NOT) rebajarse ni el paso de cobertura marcarse como no bloqueante sin un change aprobado por el owner; una caída de cobertura DEBE (MUST) corregirse agregando tests al núcleo compartido.
Trace: NFR-MAINT-002 · Priority: Must

#### Scenario: Un módulo sin tests propios baja la cobertura
- **CUANDO** el núcleo compartido tiene un módulo nuevo sin tests propios y la cobertura total queda en 89.86 % de líneas y 84.07 % de ramas
- **ENTONCES** el paso de cobertura del pipeline programado falla indicando ambas métricas frente a 95 % y 90 %
- **Y** el resumen de la corrida publica las métricas medidas

#### Scenario: Se intenta rebajar el umbral
- **CUANDO** una pull request cambia el umbral de líneas del núcleo compartido de 95 % a 89 % o marca el paso de cobertura como no bloqueante
- **ENTONCES** el test de política del pipeline falla en el gate de pull request indicando el umbral o el paso modificado

### Requirement: Sobrecosto de RLS con un criterio robusto al ruido de medición
El benchmark de sobrecosto de la seguridad a nivel de fila DEBE (MUST) comparar cada consulta con y sin la política en al menos 200 pares de ejecuciones intercaladas, y DEBE (MUST) declarar brecha en una consulta bloqueante solo cuando el límite inferior del intervalo de confianza del 95 % de la diferencia alcanza a la vez el 10 % de la mediana sin la política y el piso de 0.5 ms, o cuando la política cambia el método de acceso o el índice del plan. El reporte DEBE (MUST) publicar la diferencia, su intervalo y el motivo del veredicto.
Trace: NFR-SEC-003, NFR-PERF-005 · Priority: Should

#### Scenario: Diferencia pequeña dentro del ruido
- **CUANDO** una consulta bloqueante mide una mediana de 1.02 ms sin la política y de 1.58 ms con la política, con una mediana de las diferencias por par de 0.56 ms y un intervalo de confianza del 95 % de 0.31 ms a 0.79 ms, y el mismo plan en ambos casos
- **ENTONCES** la consulta no se declara como brecha porque el límite inferior del intervalo (0.31 ms) no alcanza el piso absoluto de 0.5 ms
- **Y** el reporte muestra la diferencia, su intervalo y el motivo "no demostrada sobre el piso absoluto"

#### Scenario: Sobrecosto real demostrado
- **CUANDO** una consulta bloqueante mide una mediana de 10.00 ms sin la política y de 13.00 ms con la política, con un intervalo de confianza del 95 % de la diferencia por par de 2.70 ms a 3.30 ms
- **ENTONCES** la consulta se declara como brecha (al menos 27 % y 2.70 ms demostrados, sobre el 10 % y el piso de 0.5 ms)
- **Y** el benchmark de rendimiento falla indicando la consulta y la diferencia medida

#### Scenario: La política cambia el plan de la consulta
- **CUANDO** sin la política la consulta de saldo por cuenta usa un acceso solo por índice sobre el índice de saldos y con la política usa un recorrido secuencial de la tabla de postings
- **ENTONCES** la consulta se declara como brecha aunque la diferencia de tiempo no esté demostrada
- **Y** el reporte muestra ambos métodos de acceso

### Requirement: Los benchmarks no miden la política de cuotas
Toda instancia de la API que levante un benchmark del pipeline programado DEBE (MUST) arrancar con las cuotas de lecturas, escrituras y operaciones costosas por minuto relajadas por encima del número de solicitudes del benchmark, mediante una única configuración compartida por todos los benchmarks. Una suite de benchmarks que configure la API sin esa configuración compartida DEBE (MUST) ser rechazada por el test de política del pipeline en el gate de pull request.
Trace: NFR-PERF-004 · Priority: Should

#### Scenario: El simulador de estrategias no recibe rechazos por cuota
- **CUANDO** el benchmark del simulador de estrategias de deuda envía 200 solicitudes de simulación en menos de un minuto, por encima de las cuotas por defecto de una instancia normal (120 escrituras y 10 operaciones costosas por minuto)
- **ENTONCES** ninguna respuesta es un rechazo por cuota
- **Y** el benchmark mide el p95 de las 200 simulaciones frente a su umbral de 300 ms

#### Scenario: Una suite nueva sin la configuración compartida
- **CUANDO** una pull request agrega una suite de benchmarks que configura la API con las cuotas por defecto
- **ENTONCES** el test de política del pipeline falla indicando el archivo de la suite
