# ADR-0031: Lectura de movimientos de exchanges con claves de solo lectura

- Estado: **Propuesto** (2026-11-04). Queda sin aceptar hasta que el owner cumpla la puerta del grupo 9 de `add-banking-providers`: leer los términos vigentes de la API privada y de la exportación de historial de Binance y Bybit desde una red con acceso, compartir las muestras reales y grabar los fixtures (tareas 9.1–9.6). Mientras tanto ningún adapter real se ofrece ni se usa (`termsStatus = PENDING`).
- Fecha: 2026-11-04 (propuesto)
- Decisores: Owner (Product/Tech Lead)
- Relacionado: Extiende [ADR-0029](0029-fuentes-de-precios-cripto.md) (cuya condición C4, «sin claves, cuentas ni endpoints privados; sin P2P», **sigue vigente para los precios públicos**); [docs/57](../57-phase-6-consolidation-decisions.md) D340–D346; `openspec/changes/add-banking-providers` (design decisiones 3, 5, 6, 7 y 10); [ADR-0027](0027-destino-de-despliegue-inicial-vps-compose.md) (VPS con Compose, sin KMS en N1); NFR-COMP-007, NFR-COMP-008, NFR-SEC-007, RISK-010, RISK-023.

## Contexto y problema

ADR-0029 verificó Binance y Bybit solo para **datos públicos de mercado** (precios) y fijó C4: ninguna clave ni endpoint privado. Importar los trades, depósitos y retiros del propio owner exige **datos privados de su cuenta**: es un alcance nuevo que ADR-0029 no cubre. FR-IMPORTS-014 (Should) lo pide y el owner opera USDT y cripto en exchanges (D251).

Hay que decidir si PFOS puede leer esos datos y cómo, sin traicionar NFR-COMP-008 (nunca usuario y contraseña; solo credenciales delegadas), NFR-SEC-007 (secretos cifrados) ni NFR-COMP-007 (términos verificados por proveedor).

## Drivers de decisión

- Los datos son del propio usuario; el exportar un archivo no requiere credenciales ni la API privada.
- Una clave de API filtrada no debe poder operar, retirar ni transferir.
- La API de PFOS no debe poder descifrar las credenciales (un compromiso de la API no entrega todas las claves).
- Sin KMS en el VPS (ADR-0027): la clave privada debe vivir fuera del repositorio y fuera de `docker inspect`.
- **No declarar apta una fuente sin evidencia** (términos leídos y registrados con fecha).

## Opciones consideradas

1. **(a) Claves de solo lectura del owner**, tras leer los términos de la API privada.
2. **(b) Solo archivos de historial exportados por el owner**, sin credenciales ni API privada.
3. **(c) Ninguna integración de exchanges** (solo el puerto y el simulado).

## Decisión propuesta

Orden fijado por D340: **(b) primero, (a) después.** Los archivos de historial (adapters `EXCHANGE_FILE_BINANCE` y `EXCHANGE_FILE_BYBIT`) no usan credenciales; la lectura por API (`EXCHANGE_API_BINANCE` y `EXCHANGE_API_BYBIT`) se habilita **solo** con este ADR aceptado y con las condiciones siguientes:

- **C1 — Solo lectura verificada.** La clave se rechaza (`CONNECTION_CREDENTIAL_NOT_READ_ONLY`) y se destruye si el proveedor informa permiso de operar, retirar o transferir; se vuelve a verificar en cada sincronización. Un exchange que no permita consultar los permisos de la clave **no se habilita**.
- **C2 — Cifrado de sobre asimétrico.** Una clave de datos por credencial (AES-256-GCM, AAD `workspace|conexión|versión`) envuelta con X25519 + HKDF-SHA256 hacia una clave pública; la **API solo tiene la pública**, la privada solo la tiene el worker (D342: archivo montado con permisos 0400 fuera del repositorio; KMS en Phase 9). Rotación por `kid` sin descifrar los secretos.
- **C3 — Nunca expuestas.** Ni en respuestas, logs, errores, auditoría, clave de idempotencia ni export; solo la huella enmascarada (`…a1b2`). Revocar destruye `wrapped_dek` y `ciphertext` en la misma unidad de trabajo que la auditoría.
- **C4 — Privacidad de las solicitudes.** Hosts de la lista del descriptor, sin seguir redirecciones a otros hosts, solo la credencial de esa conexión y la ventana pedida (NFR-COMP-001); presupuesto de 10 solicitudes por minuto por conexión y espera persistida de `Retry-After`.
- **C5 — Sin P2P ni auto-aprobación.** Las órdenes P2P quedan excluidas; toda sincronización pasa por la vista previa (D346).
- **C6 — Atribución y términos.** La fecha, las URL y el resultado de la lectura de los términos se registran **en este ADR** antes de pasar un descriptor a `VERIFIED`.

## Lo que falta para aceptarlo (tareas del owner, grupo 9)

| Pendiente | Quién | Estado |
|---|---|---|
| Leer el texto vigente de los términos de la API privada y de la exportación de historial de Binance y Bybit; registrar fecha, URL y resultado aquí | owner/red con acceso (la misma limitación que la tarea 1.5 de `add-crypto-rate-providers`) | **Pendiente** |
| Compartir en la conversación (nunca en el repositorio, D255) una exportación real de trades y de depósitos y retiros de cada exchange; fijar las fichas de formato en `docs/statement-formats/exchanges/` y pasar `formatStatus` a `VERIFIED` | owner | **Pendiente** |
| Grabar fixtures anonimizados de los endpoints privados con una clave de solo lectura del owner (la clave la carga el owner en su instancia, nunca en el repositorio ni con el agente) | owner | **Pendiente** |
| Confirmar que cada exchange publica la consulta de permisos de la clave con banderas de lectura, trading, retiros y transferencias (C1) | owner/agente con la documentación pública | **Pendiente** (la lectura de documentación de la tarea 1.4 no se pudo hacer desde la red de las sesiones) |

## Consecuencias

- Phase 6 cumple sus criterios de salida **sin** exchanges reales: el puerto, las conexiones, el cifrado, la verificación de solo lectura, la revocación y la sincronización incremental están probados con `FAKE_EXCHANGE`.
- Habilitar un exchange real = un adapter + fixtures + cambiar su descriptor (`termsStatus = VERIFIED`, ADR y fecha); nada más del código depende de ello.
- Riesgo residual: términos que prohíban el uso automatizado de la API privada (RISK-023) ⇒ el proveedor queda `REJECTED` y solo funciona el archivo.
