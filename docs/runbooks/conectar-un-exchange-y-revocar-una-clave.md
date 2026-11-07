# Runbook: conectar un exchange y revocar una clave

Cambio de referencia: `add-banking-providers` (D340–D346; [ADR-0031](../adr/0031-lectura-de-movimientos-de-exchanges-con-claves-de-solo-lectura.md), propuesto). Este runbook cubre el **alta de las claves de PFOS**, la conexión con una clave de **solo lectura**, la sincronización, el reemplazo de la credencial, la rotación de la clave maestra y la revocación.

> Hasta que el owner cumpla la puerta del grupo 9 (términos leídos, muestras y fixtures, ADR-0031 aceptado), **Binance y Bybit aparecen «pendientes de verificación»** y no admiten conexiones. El proveedor simulado `FAKE_EXCHANGE` (`IMPORTS_PROVIDER_FAKE_ENABLED=true`, solo local, CI y E2E) permite probar todo el recorrido sin red.

## 1. Preparar las claves de PFOS (una vez por entorno)

La API **cifra** las credenciales con una clave **pública**; solo el **worker** tiene la privada (D342).

1. Genera un par X25519 (cada valor son 32 bytes en base64url, 43 caracteres). En desarrollo lo hace `pnpm setup:env` (valores obvios de desarrollo, nunca reales). En producción:
   ```bash
   node --input-type=module -e "import {generateKeyPairSync as g} from 'node:crypto'; const k=g('x25519'); const pub=k.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url'); const prv=k.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64url'); console.log('PUBLICA k1:'+pub); console.log('PRIVADA k1:'+prv)"
   ```
2. **Clave pública** → `CONNECTION_CREDENTIALS_PUBLIC_KEYS=k1:<pública>` en la API **y** el worker (la primera entrada es la vigente).
3. **Clave privada** → un archivo con una línea `k1:<privada>`, **permisos 0400, fuera del repositorio**, montado en el contenedor del worker (no aparece en `docker inspect`); `CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE=/ruta/al/archivo`. La variable `CONNECTION_CREDENTIALS_PRIVATE_KEYS` solo se admite en local y CI; en staging y producción el arranque la rechaza.
4. La API **nunca** recibe la privada. Sin las claves públicas el módulo de conexiones queda deshabilitado (`BANKING_PROVIDER_NOT_AVAILABLE`) sin afectar al resto.

## 2. Crear la clave en el exchange (solo lectura)

En el exchange crea una clave de API con **solo lectura** (sin operar, sin retirar, sin transferir; si el exchange lo permite, restringe por IP). PFOS la verifica con el exchange y la **rechaza y destruye** si permite algo más (`CONNECTION_CREDENTIAL_NOT_READ_ONLY`). Nunca uses usuario y contraseña del exchange: no se aceptan.

## 3. Conectar y sincronizar

1. **Importaciones → Conexiones con exchanges → Nueva conexión.** Elige el proveedor, un nombre, mapea cada activo a una cuenta de la **misma moneda** (un activo sin cuenta llega a la vista previa como fila no importable) y pega el identificador y el secreto. El secreto no se vuelve a mostrar: solo se ve la huella (`…a1b2`).
2. La conexión queda **Verificando**; el worker comprueba que la clave sea de solo lectura y pasa a **Activa**.
3. **Sincronizar:** la primera vez indica la fecha de inicio (hasta 365 días atrás); las siguientes continúan desde el cursor de la última sincronización completada. Cada sincronización termina en una **vista previa**: no se crea nada hasta aprobar. Los depósitos y retiros llevan la señal «posible transferencia» para vincularlos a su otra cuenta o dejarlos como ingreso o gasto; las órdenes P2P se excluyen.
4. Si el exchange pide esperar (429/418 con `Retry-After`, 403 de Bybit 30 minutos), la espera se persiste y la sincronización reanuda sola sin repetir registros.

## 4. Operaciones frecuentes

| Situación | Qué hacer |
|---|---|
| `IMPORT_CONNECTION_EXPIRED` («Requiere atención») | Borraste o venció la clave: crea una de solo lectura y usa **Reemplazar credencial**; se verifica de nuevo. |
| `CONNECTION_CREDENTIAL_NOT_READ_ONLY` | La clave permite operar, retirar o transferir: se destruyó. Crea una de solo lectura y reemplaza la credencial. |
| «Requiere credencial» tras importar un workspace | El export nunca lleva credenciales: carga una clave de solo lectura (**Reemplazar credencial**). |
| `CONNECTION_SYNC_IN_PROGRESS` | Ya hay una sincronización en curso: termina o cancela su vista previa. Cancelar no mueve el cursor. |
| Rotar la clave maestra (k1 → k2) | Pasa `k2` a primera posición de `CONNECTION_CREDENTIALS_PUBLIC_KEYS` y agrega su privada al archivo del worker; el job `imports.credentials-rewrap` (corre al arrancar el worker) re-envuelve las claves de datos **sin descifrar los secretos**. Cuando todas estén en `k2`, retira `k1`. Una credencial cuyo `kid` ya no está en el llavero deja su conexión en «Requiere atención» sin detener las demás. |

## 5. Revocar

**Revocar** (solo el OWNER) destruye la credencial de forma irrecuperable en la misma operación (se borran la clave de datos envuelta y el texto cifrado), impide volver a sincronizar y queda auditado; las transacciones ya importadas y sus vínculos se conservan. **Borra también la clave en el exchange**: la revocación en PFOS no la desactiva allí.

## 6. Verificación y seguridad

- Un secreto filtrado en logs, auditoría, respuestas, clave de idempotencia o export es un incidente: la suite de integración lo busca en todos esos lugares (TC-IMPORTS-BANKING-009).
- `pf_app` (la API) no puede leer `wrapped_dek` ni `ciphertext` (grants por columna, TC-IMPORTS-BANKING-008); solo `pf_worker`.
- Las solicitudes al proveedor van solo a los hosts de su descriptor, sin seguir redirecciones a otros hosts y sin datos de PFOS (TC-IMPORTS-BANKING-031 y -032).
