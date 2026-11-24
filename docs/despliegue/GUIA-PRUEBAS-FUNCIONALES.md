# Guía de pruebas funcionales de PFOS en N1

> **Para:** el owner, en la fase 7 del [runbook de despliegue](RUNBOOK-DESPLIEGUE.md) (PoC de 48 h con datos ficticios), antes de cargar datos reales.
> **Relacionado:** [ADR-0027](../adr/0027-destino-de-despliegue-inicial-vps-compose.md), [deploy-and-restore.md](../runbooks/deploy-and-restore.md), [docs/38](../38-estado-y-pendientes.md).

Esta guía recorre la plataforma ya desplegada, área por área, con **datos ficticios**. Nunca uses datos reales tuyos acá: ni nombres de bancos reales con tus números, ni extractos, ni montos de tu vida. Los archivos de ejemplo del repositorio son sintéticos. Todo lo que cargues en el PoC se borra al cerrar la fase 7.

## Cómo leer las tablas

- **ID:** `GF-<área>-NN`. Anotá el resultado (OK, FALLA y una nota corta) en tu copia de la guía, fuera del repositorio.
- **Bloq.:** `Sí` si una falla impide cargar datos reales. Ver [Criterio de aprobación](#criterio-de-aprobación).
- **Respaldo:** el TC (en `tests/cases/`) o la spec (en `openspec/specs/`) que define el comportamiento. Si la app no hace lo que dice el TC, es un defecto.
- Las cifras usan el formato es-BO: punto de miles, coma decimal y el código de moneda (`8.000,00 BOB`).
- El español no lleva prefijo en la URL (`$BASE/cuentas`); el inglés y el portugués usan `/en/…` y `/pt/…`.

## 0. Prerrequisitos

### 0.1 Lo que tenés que tener

| Qué | Detalle |
|---|---|
| URL de la app | `$BASE` = `https://app.<dominio>`. La de Keycloak, `$AUTH` = `https://auth.<dominio>` |
| Usuario principal | Lo creás vos en el realm `pfos` (runbook, §2.6.3). Para la guía, un usuario de prueba con nombre inventado, por ejemplo «Ana Prueba» |
| Segundo usuario | Otro usuario ficticio del realm, para las pruebas de aislamiento y de roles |
| Navegador | Uno de escritorio actualizado (Chrome, Edge o Firefox) y una ventana privada para el segundo usuario. Un teléfono para la prueba móvil |
| Datos demo habilitados | Según tu decisión 5 de la fase 1 del runbook ([docs/71](../71-despliegue-n1-questions.md), pregunta 5). Si los habilitás: `DEMO_DATA_ENABLED=true` en `/etc/pfos/pfos.env` **solo durante el PoC** y redeploy del mismo SHA (fase 7, paso 1); la limpieza de la fase 7 lo vuelve a `false` y la fase 8 repite la comprobación 8 de la fase 6. Si no, mirá [§0.4](#04-si-la-demo-no-se-habilita) |
| Archivos de ejemplo | Una copia local del repositorio (o descargá los archivos de `tests/fixtures/` desde GitHub). Son sintéticos |

Configuración de N1 que condiciona lo que vas a ver:

- **Pronósticos apagados** (`FORECASTING_ENABLED` sin definir, perfil `ml` sin activar).
- **Email apagado** (`EMAIL_DRIVER=none`): las entregas por email quedan «Suprimido». Las notificaciones en la app funcionan.
- **Sin exchanges reales:** Binance y Bybit esperan la verificación de términos (ADR-0031); el exchange simulado está prohibido en producción.
- **Tasas automáticas reales:** paralelo.bo (principal) y bo.dolarapi.com (respaldo). Las cifras de tasas de los E2E no aplican.

### 0.2 Servicios sanos, vistos desde afuera

Las comprobaciones 1 a 3, y todos los `curl` de esta guía, corren en **Git Bash** en tu máquina, después de definir las tres variables (las mismas del runbook):

```bash
BASE=https://app.<dominio>
```

```bash
AUTH=https://auth.<dominio>
```

```bash
FILES=https://files.<dominio>
```

| # | Comprobación | Esperado |
|---|---|---|
| 1 | `curl -s $BASE/api/health/live` | `200` y `{"status":"ok"}` |
| 2 | `curl -s $BASE/api/health/ready` | `200` y `"status":"ready"` con `config` y `sessionStore` en `up` |
| 3 | `curl -s -o /dev/null -w "%{http_code}\n" $AUTH/realms/pfos/.well-known/openid-configuration` | `200` |
| 4 | Iniciar sesión y abrir **Cuentas** | La lista carga (vacía o con datos) sin error |

Los endpoints de salud son de la web: **no** comprueban la API ni Keycloak. La 3 cubre Keycloak y la 4 cubre la API. En el host, `$C ps` (alias `$C` con rutas absolutas del [runbook de despliegue](RUNBOOK-DESPLIEGUE.md#valores-que-vas-a-necesitar), que funciona desde cualquier directorio) muestra `healthy` en `finance-web`, `finance-api`, `finance-worker`, `keycloak`, `postgres`, `object-storage` y `caddy`.

### 0.3 Dos espacios de trabajo para la guía

1. **«GF Pruebas»:** workspace real (no demo) que creás a mano y llenás con los casos de esta guía. Sirve para todo lo que crea o modifica datos y para el export, que no se puede restaurar desde un workspace demo.
2. **Workspace demo «Demo — Finanzas de Valeria»:** lo genera la app. Sirve para mirar reportes, deudas, metas y suscripciones con 21 meses de historia ficticia.

**Generar los datos demo:** en «GF Pruebas», **Configuración** → sección «Datos de demostración» → «Cargar datos de demostración» → «Sí, cargar». Esperá «Datos de demostración listos (al {fecha}).» y pulsá «Ir al espacio de demostración». Tarda alrededor de 30 s.

La fecha ancla de la demo es **el día de la carga**, no 2026-09-30. Por eso la guía verifica estados y nombres, no saldos al centavo: los saldos exactos de la spec valen solo con el ancla 2026-09-30.

### 0.4 Si la demo no se habilita

Si en la fase 1 elegiste no habilitar `DEMO_DATA_ENABLED`, la demo no existe y cambia esto:

- **Dejan de ser bloqueantes y se saltean:** GF-ACC-09, GF-ACC-10, GF-COM-05, GF-DEU-07, GF-REP-02 y GF-EXP-06.
- **Siguen siendo bloqueantes, pero en «GF Pruebas»:** los 15 reportes de §12.2 tienen que abrir sin error con los datos de «GF Pruebas» (las cifras esperadas de la tabla, que son de la demo, no aplican).
- **Se saltean sin efecto en la aprobación:** GF-ACC-11, GF-PLA-06, GF-COM-06, GF-COM-07, GF-DEU-08, GF-DEU-09 y GF-MET-04. Los de §13 (GF-FLU-01 a 04) se pueden correr en «GF Pruebas» con la definición de GF-COM-01.
- En la fase 7 del runbook, la carga se hace sin el paso de los datos demo.

## 1. Acceso y workspace

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-ACC-01 | Abrir `$BASE`, «Iniciar sesión» con el usuario principal | Keycloak pide usuario, contraseña y OTP; vuelve a Inicio con «Hola, {nombre}» | Sí | TC-IDENTITY-AUTH-002 |
| GF-ACC-02 | Menú de la cuenta → «Cerrar sesión»; luego volver atrás con el navegador | Pide iniciar sesión de nuevo; la sesión anterior no da acceso | Sí | TC-IDENTITY-AUTH-004 |
| GF-ACC-03 | Menú de la cuenta → «Nuevo espacio de trabajo»: «Nombre» = GF Pruebas, «Moneda base» = BOB, marcar «Cargar el catálogo sugerido de categorías» → «Crear espacio» | «Espacio de trabajo creado: GF Pruebas.»; **Clasificación** muestra el catálogo sugerido | Sí | TC-IDENTITY-WORKSPACE-001, TC-CLASSIFICATION-SEED-001 |
| GF-ACC-04 | **Configuración**: revisar «Moneda base», «Zona horaria», «Idioma y formato» | BOB, America/La_Paz y es-BO | Sí | TC-IDENTITY-WORKSPACE-003 |
| GF-ACC-05 | **Configuración** → «Zona horaria» = `GMT-4 Bolivia` → «Guardar cambios» | Error «No es una zona horaria IANA válida (por ejemplo America/La_Paz).»; nada se guarda | No | TC-IDENTITY-WORKSPACE-003 |
| GF-ACC-06 | Abrir **Configuración** en dos pestañas; guardar un cambio en una y después otro en la otra | La segunda dice «Este registro cambió desde que lo abriste…» y ofrece «Cargar la versión actual» | No | TC-IDENTITY-WORKSPACE-003 |
| GF-ACC-07 | Con el segundo usuario (ventana privada), iniciar sesión | No ve «GF Pruebas» ni la demo del primero | Sí | TC-SECURITY-ISOLATION-001 |
| GF-ACC-08 | Con el segundo usuario, pegar la URL de una cuenta de «GF Pruebas» (`$BASE/cuentas/<id>`) | No ve datos; responde como recurso inexistente o sin permiso | Sí | TC-SECURITY-ISOLATION-001 |
| GF-ACC-09 | Cargar la demo (§0.3) | Estado de carga con progreso, luego «Datos de demostración listos…»; el selector muestra «Demo — Finanzas de Valeria (demostración)» | Sí | TC-IDENTITY-DEMO-001, TC-IDENTITY-DEMO-004 |
| GF-ACC-10 | En la demo, recorrer 3 pantallas | Banner «Datos de demostración — este espacio contiene datos ficticios…» en todas | Sí | TC-IDENTITY-DEMO-004 |
| GF-ACC-11 | Volver a «Configuración» → «Cargar datos de demostración» otra vez | `DEMO_WORKSPACE_ALREADY_EXISTS`: «Ya tienes un workspace de demostración…» | No | TC-IDENTITY-DEMO-001 |
| GF-ACC-12 | **Configuración** → «Auditoría» | Lista con filtros de actor, acción y categoría; aparecen la creación del workspace y la carga de la demo | No | TC-AUDIT-GLOBAL-001 |

La limpieza de la demo («Limpiar datos de demostración») se prueba al final, en GF-EXP-06.

## 2. Cuentas y monedas

En «GF Pruebas».

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-CTA-01 | **Cuentas** → «Nueva cuenta»: «Nombre» = Banco Prueba BOB, tipo Banco, moneda BOB, «Número de cuenta o tarjeta» = DEMO-000123456789, «Saldo inicial en BOB» = 10000 → «Crear cuenta» | «Cuenta creada.», saldo «10.000,00 BOB», máscara «•••• 6789» | Sí | TC-ACCOUNTS-MASK-001 |
| GF-CTA-02 | Crear «Visa Prueba» (Tarjeta de crédito, BOB) con 2000 de saldo inicial | La liquidez se fija en «No líquida»; muestra «Adeuda 2.000,00 BOB». En Inicio, patrimonio 8.000,00 BOB | Sí | TC-ACCOUNTS-LIQUIDITY-001, TC-ACCOUNTS-CREDITCARD-001 |
| GF-CTA-03 | Crear «Caja Prueba» (Efectivo, BOB, 0) y «Wallet Prueba» (USDT, 150) | Ambas aparecen en la lista con su moneda | Sí | TC-ACCOUNTS-LIST-001 |
| GF-CTA-04 | Crear «Banco Prueba USD» (USD, 500) sin tasa manual registrada | Muestra «Sin tasa a BOB: equivalente no disponible» o el equivalente con la tasa automática si ya llegó | No | TC-ACCOUNTS-LIST-001 |
| GF-CTA-05 | Crear otra cuenta con el nombre «Banco Prueba BOB» | `ACCOUNT_NAME_TAKEN`: «Ya tienes una cuenta activa con ese nombre.» | No | TC-ACCOUNTS-ARCHIVE-001 |
| GF-CTA-06 | En «Caja Prueba»: «Archivar» → «Sí, archivar»; marcar «Mostrar archivadas»; «Reactivar» | «Cuenta archivada.», luego «Cuenta reactivada.»; «Historial de cambios» muestra las dos | No | TC-ACCOUNTS-ARCHIVE-001 |
| GF-CTA-07 | Abrir «Banco Prueba BOB» y revisar «Identificador (últimos 4)» | `6789`: solo se guardan los últimos 4 caracteres (los usa la lectura de PDF, §6) | No | TC-ACCOUNTS-MASK-001 |

Las monedas habilitadas no tienen pantalla propia: la app usa las del workspace (BOB, USD, USDT y las demás del seed).

## 3. Transacciones y splits

En «GF Pruebas», sobre «Banco Prueba BOB». Usá **Transacciones** → «Nuevo movimiento».

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-TX-01 | Gasto de 150,00 «Compra mixta» con dos partes: 100 y 40 | «Restante por asignar: 10,00 BOB» y no deja registrar | Sí | TC-TRANSACTIONS-SPLIT-001 |
| GF-TX-02 | En el mismo formulario, «Repartir en partes iguales» → «Registrar» | Partes 75,00 y 75,00, «Restante por asignar: 0 (cuadra).», «Movimiento registrado.» | Sí | TC-TRANSACTIONS-SPLIT-001 |
| GF-TX-03 | Abrir la transacción → «Editar» → monto 120,00 → repartir → «Guardar cambios» | «Cambios guardados: reversa y nuevo asiento (revisión 2).», partes 60,00 y 60,00 | Sí | TC-TRANSACTIONS-EDIT-001 |
| GF-TX-04 | «Marcar como confirmada»; abrir «Historial de cambios» y «Recorrido» | «Transacción confirmada.»; el recorrido muestra «— → Contabilizada», la revisión 1 → 2 y «Contabilizada → Confirmada» | Sí | TC-TRANSACTIONS-CLEARED-002, TC-AUDIT-LIFECYCLE-013 |
| GF-TX-05 | Gasto de 30,00 «Taxi» → «Anular» sin motivo, después con «Duplicado del banco» | «Sí, anular» queda deshabilitado sin motivo; luego «Transacción anulada.» y estado «Anulada» | Sí | TC-TRANSACTIONS-EDIT-001 |
| GF-TX-06 | Revisar el saldo de «Banco Prueba BOB» | 10.000 − 120 = **9.880,00 BOB** (el gasto anulado no cuenta) | Sí | TC-TRANSACTIONS-SPLIT-001 |
| GF-TX-07 | Ingreso de 300 y reembolso de 50 sobre un gasto previo (`Nuevo movimiento` → «Reembolso» → «Gasto que se reembolsa») | El reembolso aparece como «+50,00 BOB» y resta del gasto del mes en Inicio | No | TC-TRANSACTIONS-REFUND-001 |
| GF-TX-08 | Ajuste que disminuye 12,50 sin motivo | «El ajuste necesita un motivo.» | No | TC-TRANSACTIONS-REFUND-001 |
| GF-TX-09 | Gasto de 45,905 BOB | Rechaza: BOB admite hasta 2 decimales | Sí | TC-TRANSACTIONS-AMOUNT-001 |
| GF-TX-10 | Seleccionar 3 gastos → «Recategorizar» → categoría Hogar → «Ver vista previa» → «Aplicar a 3 transacciones» | «3 transacciones actualizadas. Operación {id}.»; el saldo no cambia; el enlace lleva a la auditoría de la operación | No | TC-TRANSACTIONS-BULK-001, TC-AUDIT-GLOBAL-007 |
| GF-TX-11 | Con el segundo usuario agregado como Lector (si invitás miembros), abrir una transacción | Ve el historial sin «Editar» ni «Anular» | No | TC-TRANSACTIONS-HISTORY-002 |

## 4. Transferencias y conversión con FX

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-FX-01 | «Transferencia»: desde «Banco Prueba BOB» hacia «Caja Prueba», 300 | Patas −300,00 y +300,00; el patrimonio no cambia | Sí | TC-TRANSACTIONS-TRANSFER-008, TC-TRANSACTIONS-TRANSFER-007 |
| GF-FX-02 | Transferencia de «Banco Prueba BOB» a «Banco Prueba USD» | «Las cuentas tienen monedas distintas (BOB → USD): esto es una conversión…»; ofrece «Registrar como conversión» | Sí | TC-TRANSACTIONS-TRANSFER-001 |
| GF-FX-03 | Compra de 350 con «Visa Prueba»; luego «Pagar tarjeta» desde el banco → «Pagar el total» → «Registrar pago» | La tarjeta baja 350; el gasto se cuenta una sola vez en Inicio | Sí | TC-TRANSACTIONS-CARDPAYMENT-001 |
| GF-FX-04 | **Cripto y FX** → «Registrar una tasa manual»: USDT → BOB, 6,95, tipo P2P, fuente «Casa ficticia» | «Tasa registrada: 1 USDT = 6,95 BOB.» | Sí | TC-FX-RATE-001 |
| GF-FX-05 | «Nueva conversión»: desde «Wallet Prueba» 100 USDT hacia «Banco Prueba BOB» 685 BOB, tasa cotizada 6,90, referencia la P2P, comisión 5 → «Calcular resumen» → «Registrar conversión» | Efectiva «6,85 BOB/USDT», spread 0,72 %, comisión 5,00 BOB; wallet 50,000000 USDT | Sí | TC-TRANSACTIONS-CONVERSION-001, TC-TRANSACTIONS-CONVERSION-009 |
| GF-FX-06 | Corregir la tasa P2P a 6,99 con motivo | «…la versión anterior se conserva como reemplazada.»; la conversión ya registrada no cambia | No | TC-FX-HISTORICAL-002 |
| GF-FX-07 | Pestaña «Proveedores» | paralelo.bo y bo.dolarapi.com con estado «Saludable» o «Degradado», «Fuente: paralelo.bo» y «CC BY 4.0» | No | TC-FX-PROVIDER-012 |
| GF-FX-08 | «Ver costo de conversiones» → rango que incluya hoy → «Aplicar» → «Exportar CSV» | La conversión de GF-FX-05 aparece con su costo; descarga un CSV | No | TC-FX-COST-009 |

Si un provider queda «Caído» más de un día: [fx-provider-caido.md](../runbooks/fx-provider-caido.md). No bloquea: la valoración usa el respaldo o la tasa manual.

## 5. Categorías y reglas

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-CLA-01 | **Clasificación** → «Nueva categoría» en un grupo de gasto: «Fibra óptica» → «Crear» | «Categoría «Fibra óptica» creada.» | No | TC-CLASSIFICATION-CATEGORY-001 |
| GF-CLA-02 | Archivar «Fibra óptica» después de usarla en un gasto | Desaparece del selector de transacciones nuevas; el gasto viejo la conserva | No | TC-CLASSIFICATION-ARCHIVE-001 |
| GF-CLA-03 | Contraparte «Tigo Prueba» con alias «TIGO MONEY» y categoría por defecto | «Contraparte «Tigo Prueba» creada.» y el alias listado | No | TC-CLASSIFICATION-COUNTERPARTY-001 |
| GF-CLA-04 | Registrar 4 gastos «HIPERMAXI SUC 1» a «HIPERMAXI SUC 4» sin categoría. **Reglas** → «Nueva regla»: texto `hipermaxi`, acción categoría Supermercado; vista previa con «HIPERMAXI SUC 12» y con «FARMACORP» | «La regla coincide con el ejemplo.» y «La regla no coincide con el ejemplo.» | Sí | TC-RULES-ENGINE-001, TC-RULES-ENGINE-025 |
| GF-CLA-05 | «Guardar regla» → «Ejecutar sobre el historial» con rango de hoy → «Ejecutar (sin cambiar nada)» → «Aplicar 4 transacciones» | «… 4 cambiarían.», luego «Se aplicaron 4 transacciones…»; el detalle dice «por la regla … (v1)» | Sí | TC-RULES-ENGINE-027, TC-RULES-ENGINE-044 |
| GF-CLA-06 | Pestaña «Cobertura» | Muestra la cobertura del rango (sin importaciones todavía, estado vacío) | No | TC-RULES-ENGINE-044 |
| GF-CLA-07 | Categorizá a mano 3 gastos «RECARGA PRUEBA» iguales y dejá 1 sin categoría; pestaña «Sugerencias» → «Probar» | Aparece el patrón con «3 de 3 transacciones»; «Probar» no cambia nada | No | TC-RULES-SUGGEST-026 |

Guía de uso: [crear-y-probar-reglas.md](../runbooks/crear-y-probar-reglas.md).

## 6. Importación: CSV, OFX y PDF

Todos los archivos son sintéticos y están en el repositorio. Las importaciones arrancan con «Importar CSV» desde el detalle de la cuenta o desde **Transacciones** (asistente «Archivo → Columnas → Revisar → Resultado»). La vía principal sube el archivo como documento («Subir y procesar»), así que requiere que funcione el dominio de archivos (§15).

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-IMP-01 | Cuenta nueva «Banco Import» (BOB, 4000) con un gasto manual «Supermercado» de 245,30 del 02/10/2026. Importar [`tests/fixtures/imports/csv/extracto-octubre/input.csv`](../../tests/fixtures/imports/csv/extracto-octubre/input.csv) | Detecta «Windows-1252, separador punto y coma, 3 columnas»; en la muestra se lee «PAGO QR CAFÉ» | Sí | TC-IMPORTS-CSV-001 |
| GF-IMP-02 | Mapear: fecha col. 1 (dd/MM/yyyy), descripción col. 2, monto col. 3 «negativo es salida», decimal «,» | Resumen «4 filas · 3 nuevas · 0 ya importadas · 1 posibles duplicados · 0 con errores»; no deja aprobar hasta decidir el duplicado | Sí | TC-IMPORTS-CSV-015, TC-IMPORTS-CSV-020 |
| GF-IMP-03 | «Omitir» el duplicado → «Aprobar e importar» | «Se crearán 3 transacciones.»; resultado «…se crearon 3 transacciones sin categoría.»; saldo resultante **11.718,70 BOB** | Sí | TC-IMPORTS-CSV-015 |
| GF-IMP-04 | Importar el mismo archivo otra vez | Aviso «Este mismo archivo ya se importó…»; «4 filas · 0 nuevas · 4 ya importadas…»; no se puede aprobar; **0 creadas** | Sí | TC-IMPORTS-CSV-023 |
| GF-IMP-05 | Cuenta «Banco Tres Meses» (BOB). Importar [`tres-meses/enero-15feb.csv`](../../tests/fixtures/imports/tres-meses/enero-15feb.csv) (52 movimientos) y aprobar | 52 transacciones creadas | Sí | TC-IMPORTS-PIPELINE-055 |
| GF-IMP-06 | En la misma cuenta, importar [`tres-meses/feb-mar.ofx`](../../tests/fixtures/imports/tres-meses/feb-mar.ofx) (75 movimientos), omitir los 12 posibles duplicados y aprobar | Se crean 63; la cuenta queda con **115** transacciones importadas | Sí | TC-IMPORTS-PIPELINE-055 |
| GF-IMP-07 | Reimportar `feb-mar.ofx` | Todas «ya importadas»; **0 creadas** | Sí | TC-IMPORTS-PIPELINE-056 |
| GF-IMP-08 | En una importación terminada: «Ver qué se anularía» → «Deshacer todo» → «Deshacer» | «Importación deshecha: se anularon N transacciones.»; el saldo vuelve al anterior; reimportar vuelve a mostrarlas como nuevas | No | TC-IMPORTS-PIPELINE-057 |
| GF-IMP-09 | Importar [`qif/banco.qif`](../../tests/fixtures/imports/qif/banco.qif) y [`json/valido.json`](../../tests/fixtures/imports/json/valido.json) | Pasan directo a «Revisar», sin mapeo; el JSON trae 3 movimientos | No | TC-IMPORTS-PIPELINE-017, TC-IMPORTS-PIPELINE-020 |
| GF-IMP-10 | Importar [`ofx/extracto-usd.ofx`](../../tests/fixtures/imports/ofx/extracto-usd.ofx) en una cuenta BOB | Rechazo por moneda distinta; no crea nada | No | TC-IMPORTS-PIPELINE-016 |
| GF-IMP-11 | Importar [`csv/edge/png-renamed.csv`](../../tests/fixtures/imports/csv/edge/png-renamed.csv) | Rechazo por contenido; no crea nada | No | TC-IMPORTS-CSV-005 |
| GF-IMP-12 | PDF con texto que no es un extracto (por ejemplo, una página web impresa a PDF) | `PARSE_FAILED`: «Este PDF tiene texto pero no coincide con ningún formato de extracto conocido…»; 0 filas | No | TC-IMPORTS-PDF-014 |
| GF-IMP-13 | PDF escaneado o una foto guardada como PDF | «Este PDF no tiene texto (parece escaneado o fotografiado)…»; 0 filas | No | TC-IMPORTS-PDF-010 |
| GF-IMP-14 | Abrir `$BASE/imports/perfiles` y `$BASE/imports/conexiones` (el menú no tiene una entrada «Imports») | Perfiles: los guardados (o el estado vacío); conexiones: «Todavía no hay conexiones.» y el selector de proveedor sin opciones | No | TC-IMPORTS-BANKING-004 |

**Lectura de un PDF que sí cuadra:** el repositorio no versiona PDF; los E2E los generan con [`paint-statement.ts`](../../tests/fixtures/imports/statements-bo/pdf/paint-statement.ts) (diseño Ganadero: 11 filas, 2 de 2 páginas, TC-IMPORTS-PDF-048). No hay un comando que lo deje en disco. Por eso esta guía solo prueba los rechazos (GF-IMP-12 y 13). La prueba con extractos reales es del owner, fuera del repositorio (ver la sección final).

Uso detallado: [importar-extracto-csv.md](../runbooks/importar-extracto-csv.md).

## 7. Presupuestos y periodos

En «GF Pruebas», **Planificación**.

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-PLA-01 | «Periodos» | El periodo actual «Activo» y los siguientes en «Borrador»; el selector marca «(actual)» | Sí | TC-PLANNING-AUTOCREATE-001 |
| GF-PLA-02 | «Presupuestos» → «Crear el plan del periodo» → «Agregar línea»: categoría Restaurantes, Máximo, 600,00 | «Plan creado.» y «Línea agregada.»; umbrales 50/75/90/100 | Sí | TC-PLANNING-BUDGET-001 |
| GF-PLA-03 | Gastos en Restaurantes: 280, luego 30, luego 240 | 46,7 % «Dentro del límite»; luego 51,7 %; luego 91,7 % con 50,00 restante | Sí | TC-PLANNING-THRESHOLD-003, TC-PLANNING-BUDGET-006 |
| GF-PLA-04 | Otro gasto de 60 | Restante −10,00 y «Excedido» | No | TC-PLANNING-THRESHOLD-006 |
| GF-PLA-05 | «Templates» → «Mes estándar» con dos líneas → «Publicar versión» → «Marcar como predeterminado» | «Versión 2 publicada.» y «Template marcado como predeterminado.» | No | TC-PLANNING-TEMPLATE-001, TC-PLANNING-TEMPLATE-002 |
| GF-PLA-06 | En la demo: «Presupuestos» → «Sugerir desde el historial» → 3 periodos → «Calcular sugerencias» | Propone líneas con su explicación; nada viene preseleccionado; aplicar es explícito | No | TC-PLANNING-HISTBUDGET-020 |

## 8. Cierre de mes

Un periodo solo se cierra después de terminar. Para tener uno terminado en «GF Pruebas», registrá un gasto ficticio con fecha del mes anterior: la planificación crea ese periodo.

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-CIE-01 | **Planificación** → «Cierre de mes» del periodo actual | «Checklist de cierre», aviso «El periodo termina el {fecha}…» y «Cerrar mes» deshabilitado | Sí | TC-PLANNING-CLOSE-005, TC-PLANNING-CHECKLIST-002 |
| GF-CIE-02 | **Cuentas** → cuenta con movimientos del mes anterior → «Reconciliar cuenta», fecha fin de ese mes, saldo igual al confirmado → «Finalizar conciliación» | «Diferencia 0,00 Cuadra» y «Conciliación finalizada…» | Sí | TC-TRANSACTIONS-RECONCILIATION-006 |
| GF-CIE-03 | Conciliar con un saldo que difiere en 5,00 | Panel «La diferencia no es cero»; exige «Motivo del ajuste» para crear el ajuste | No | TC-TRANSACTIONS-RECONCILIATION-008 |
| GF-CIE-04 | Cierre del mes anterior: revisar el checklist, reconocer advertencias si las hay → «Cerrar mes» | «…Versión 1 del cierre guardada.» | Sí | TC-PLANNING-RECLOSE-001 |
| GF-CIE-05 | Registrar un gasto con fecha de ese mes | `PERIOD_CLOSED`: «El mes de esa fecha está cerrado…» | Sí | TC-PLANNING-RECLOSE-001 |
| GF-CIE-06 | «Reabrir periodo» sin motivo y luego con motivo; registrar el gasto; volver a cerrar | Sin motivo: «Indica el motivo de la reapertura.»; después, cierre versión 2 | Sí | TC-PLANNING-RECLOSE-002 |
| GF-CIE-07 | «Reporte de cierre» del periodo → exportar CSV | Muestra la diferencia entre versión 1 y 2; descarga el CSV | No | TC-PLANNING-REPORT-003 |

## 9. Compromisos y suscripciones

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-COM-01 | En «GF Pruebas», **Recurrentes** → «Definiciones» → «Nueva definición»: «Internet», Estimado, 199,00, inicio hoy → «Crear definición» | La vista previa muestra 6 fechas; «Creaste «Internet»» | Sí | TC-COMMITMENTS-RECUR-021 |
| GF-COM-02 | Pestaña «Por aprobar» → aprobar con monto real 205,50 | «Aprobaste Internet»; se crea el gasto | Sí | TC-COMMITMENTS-RECUR-023 |
| GF-COM-03 | Anular ese gasto | La ocurrencia vuelve a «Por aprobar» | No | TC-COMMITMENTS-RECUR-031 |
| GF-COM-04 | Inicio → tarjeta «¿Qué pagos vienen?» → «Ver todos los pagos próximos» | Lista de pagos con montos fijos, estimados y «Monto variable»; saldo proyectado | No | TC-REPORTING-UPCOMING-017 |
| GF-COM-05 | En la demo, **Recurrentes** → «Ver mis suscripciones y su costo» | 8 suscripciones: 5 activas, 1 en prueba («Curso Kantuta Demo»), 1 pausada y 1 cancelada | Sí | TC-IDENTITY-DEMO-015 |
| GF-COM-06 | En la demo, abrir «StreamFlix Demo» | 11,99 USD mensual; historial de precios 9,99 → 11,99 USD | No | TC-IDENTITY-DEMO-015 |
| GF-COM-07 | En la demo, «Por aprobar» | Al menos una ocurrencia atrasada: «Internet Fibra Kantuta Demo», 199,00 BOB | No | TC-IDENTITY-DEMO-015 |

## 10. Préstamos, amortización y tarjetas

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-DEU-01 | En «GF Pruebas», **Deudas** → «Nuevo préstamo»: 50.000,00 BOB, 11,50 %, 24 cuotas, francés, desembolso hoy | Vista previa con cuota **2.342,02 BOB**, 24 filas e interés de la primera 479,17 | Sí | TC-DEBT-LOAN-001 |
| GF-DEU-02 | «Guardar préstamo» → «Desembolsar» → «Registrar pago» (cuota prellenada) | «Deuda 50.000,00 BOB», luego «Pago registrado.» y «Deuda 48.137,15 BOB» | Sí | TC-DEBT-LOAN-012 |
| GF-DEU-03 | Préstamo ficticio de [`tests/fixtures/loans/plan-pagos-vehicular`](../../tests/fixtures/loans/README.md): 85.000,00 BOB, 11,50 %, 36 cuotas, 30/360, francés, desembolso 15/10/2026. «Comparar con la tabla del banco» → pegar `input.csv` → «Detectar columnas» → «Cargar y comparar» | Coincide al centavo (cuota 1: 2.802,96) | No | TC-DEBT-AMORT-015 |
| GF-DEU-04 | Repetir la comparación con `variante-fechas-banco.csv` | Diferencia solo en la cuota 7; «Explicar la diferencia» la deja explicada | No | TC-DEBT-AMORT-015, TC-DEBT-AMORT-018 |
| GF-DEU-05 | «Simulador de pagos extra»: préstamos de 3.000 al 12 % y 12.000 al 24 %, extra 500 → «Simular» | Interés sin estrategia 3.425,46; avalancha 1.815,57; bola de nieve 2.000,08 | No | TC-DEBT-AMORT-042 |
| GF-DEU-06 | «Nueva tarjeta»: límite 15000, mínimo 5 % con piso 50, día de cierre 32 | Error de campo en el día de cierre; con un día válido, «Registrar tarjeta» la crea | No | TC-DEBT-CARD-001 |
| GF-DEU-07 | En la demo, **Deudas** → «Préstamos» | «Préstamo vehicular» activo (36 cuotas de 1.589,99 BOB); «Préstamo de consumo» con cuotas en mora; «Préstamo familiar» saldado; «Crédito educativo» en USD con cronograma versión 2 | Sí | TC-IDENTITY-DEMO-018 |
| GF-DEU-08 | En la demo, pestaña «Tarjetas» → «Tarjeta Kantuta Demo» | Bimoneda BOB/USD; el estado de cuenta USD anterior al último «Vencido» y el último «Emitido»; cargos futuros de 800,00 BOB por las cuotas del «Refrigerador» | No | TC-IDENTITY-DEMO-016 |
| GF-DEU-09 | En la demo, pestaña «Resumen» | Deuda en BOB y USD con su consolidado; «Préstamo familiar» no figura | No | TC-IDENTITY-DEMO-019 |

## 11. Metas de ahorro

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-MET-01 | En «GF Pruebas», crear una cuenta de ahorro «Ahorro Prueba» (BOB, 0). **Metas** → «Nueva meta»: «Fondo de emergencia», 15000, fecha +180 días, vinculada a «Ahorro Prueba» | Meta creada con 0 % | No | TC-GOALS-SAVINGS-001 |
| GF-MET-02 | «Aportar o reservar» → aporte de 1.000 del banco a «Ahorro Prueba» | Resta 14.000,00; progreso 6,67 % | No | TC-GOALS-SAVINGS-012 |
| GF-MET-03 | Meta «Laptop» con reserva de 2.000 en el banco; abrir «Reservas por cuenta» | El banco muestra 2.000,00 reservado y el resto disponible | No | TC-GOALS-SAVINGS-046 |
| GF-MET-04 | En la demo, **Metas** | «Viaje» atrasada, «Laptop» alcanzada, «Fondo de emergencia» y «Regalos» presentes | No | TC-IDENTITY-DEMO-017 |

## 12. Reportes, exportación CSV y Home

### 12.1 Home

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-REP-01 | Workspace nuevo y vacío (creá «GF Vacío»): abrir Inicio | Las tarjetas sin datos piden crear una cuenta o una meta; no muestran «0,00» | No | TC-REPORTING-DASHBOARD-005 |
| GF-REP-02 | En la demo, Inicio | Q1 a Q6, Q8 y Q9 con cifras; montos con formato es-BO | Sí | TC-REPORTING-FORECAST-030 |
| GF-REP-03 | En «GF Pruebas», Inicio → «¿Cuánto puedo gastar?» → «Ver el detalle del disponible» | Desglose «Dinero líquido», «Reservado para metas», «Comprometido» y «Disponible» | No | TC-REPORTING-SPENDABLE-012 |
| GF-REP-04 | Inicio → «Ver la evolución completa…» (patrimonio) | Serie mensual con las tasas usadas | No | TC-REPORTING-NETWORTH-006 |

### 12.2 Los 15 reportes

En la demo, **Reportes**. El catálogo tiene 16 entradas: 15 «Disponible» y «Pronóstico vs real» en «Planificado». El PDF de reportes está diferido (D401): no hay que buscarlo.

| ID | Reporte (slug) | Esperado al abrirlo con el rango por omisión | Respaldo |
|---|---|---|---|
| GF-REP-10 | Ingresos y gastos (`ingresos-gastos`) | Cifras por periodo y bloque «Cómo se convirtió» | TC-REPORTING-REPORTS-001 |
| GF-REP-11 | Presupuesto vs real (`presupuesto-vs-real`) | Líneas del plan con su real | TC-REPORTING-REPORTS-001 |
| GF-REP-12 | Gastos por categoría (`gastos-por-categoria`) | Categorías con drill-down «Ver el detalle de …» | TC-REPORTING-REPORTS-026 |
| GF-REP-13 | Flujo de caja (`flujo-de-caja`) | Entradas y salidas por periodo | TC-REPORTING-REPORTS-001 |
| GF-REP-14 | Patrimonio neto (`patrimonio`) | Serie con descomposición | TC-REPORTING-REPORTS-001 |
| GF-REP-15 | Historial de saldo de una cuenta (`historial-de-saldo`) | Pide la cuenta; muestra el saldo diario | TC-REPORTING-REPORTS-001 |
| GF-REP-16 | Gastos por etiqueta (`gastos-por-etiqueta`) | Aviso de que los totales no son aditivos | TC-REPORTING-REPORTS-054 |
| GF-REP-17 | Gastos por cuenta (`gastos-por-cuenta`) | Una fila por cuenta | TC-REPORTING-REPORTS-039 |
| GF-REP-18 | Tendencias mensuales (`tendencias`) | Hasta 7 series más «Otras categorías» | TC-REPORTING-REPORTS-039 |
| GF-REP-19 | Comisiones y cargos (`comisiones`) | Comisiones de las conversiones de la demo | TC-REPORTING-REPORTS-039 |
| GF-REP-20 | Metas de ahorro (`metas`) | Las 4 metas de la demo | TC-REPORTING-REPORTS-039 |
| GF-REP-21 | Evolución de deudas (`deudas`) | Préstamos y tarjetas en el tiempo | TC-REPORTING-REPORTS-039 |
| GF-REP-22 | Costos recurrentes y suscripciones (`costos-recurrentes`) | Sin rango de fechas; costo mensualizado | TC-REPORTING-REPORTS-039 |
| GF-REP-23 | Evolución de suscripciones (`suscripciones`) | Altas, bajas y cambio de precio de StreamFlix | TC-REPORTING-REPORTS-039 |
| GF-REP-24 | Conversiones de moneda y cripto (`conversiones`) | Conversiones de la demo con su tasa | TC-REPORTING-REPORTS-039 |

Bloqueante en este bloque: que los 15 abran sin error. Las cifras son de la demo y dependen de su ancla.

### 12.3 Cifras exactas, comparación y CSV

En «GF Pruebas», en una cuenta BOB: gasto de 3.500 y reembolso de 200 en la categoría A este mes; gasto de 500 en la categoría B; gasto de 1.000 en la categoría A con fecha del mes anterior.

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-REP-30 | «Gastos por categoría», rango de este mes | Categoría A **3.300,00 BOB** | Sí | TC-REPORTING-REPORTS-026 |
| GF-REP-31 | «Ver el detalle de …» de A | Panel «Detalle de la cifra» con 2 filas y total 3.300,00; cada fila abre su transacción | No | TC-REPORTING-REPORTS-026 |
| GF-REP-32 | «Comparar con» → «Periodo anterior» → «Aplicar filtros» | Variación **+2.300,00 BOB** con porcentaje | No | TC-REPORTING-REPORTS-026 |
| GF-REP-33 | «Exportar CSV» | Descarga `expenses-by-category-*.csv` con las mismas cifras | Sí | TC-REPORTING-REPORTS-026 |
| GF-REP-34 | Panel «Vistas guardadas» → nombre «Prueba» → «Guardar vista» → reabrirla | «Vista guardada.» y se reabre con los mismos filtros | No | TC-REPORTING-REPORTS-054 |

## 13. Calendario de flujo de caja

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-FLU-01 | En la demo, **Flujo de caja**; cambiar «7 días», «30 días», «60 días», «90 días» | Calendario de 8, 31, 61 y 91 filas; la URL lleva `?horizonte=…` | No | TC-REPORTING-FORECAST-020 |
| GF-FLU-02 | Revisar el riesgo por moneda | Una de «Sin riesgo», «Riesgo bajo», «Riesgo posible», «Riesgo alto», con fecha y faltante si corresponde | No | TC-REPORTING-FORECAST-020 |
| GF-FLU-03 | Bloque «Con tu gasto variable predicho» | «Los pronósticos no están habilitados en esta instalación…»; el calendario funciona igual, sin banda | No | TC-REPORTING-PREDICTED-006 |
| GF-FLU-04 | En una ocurrencia recurrente, «Omitir» y confirmar | El saldo final del calendario cambia en el momento | No | TC-REPORTING-FORECAST-020 |

## 14. Pronósticos

En N1 el servicio viene **apagado**. Esta sección solo verifica que la app lo diga bien y que nada se rompa.

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-PRO-01 | **Pronósticos** | Aviso «Los pronósticos son estimaciones estadísticas…»; panel «Estado del servicio de pronósticos» con «No habilitado en esta instalación.»; sin botón «Actualizar pronóstico» | No | TC-FORECAST-SERVICE-002 |
| GF-PRO-02 | `/en/pronosticos` y `/pt/pronosticos` | El mismo estado, traducido | No | TC-FORECAST-SERVICE-002 |

Con el perfil `ml` habilitado (después, siguiendo la nota as-built de [deploy-and-restore.md](../runbooks/deploy-and-restore.md#nota-as-built-add-ml-forecasting-service-phase-8-2026-11-12)): «Actualizar pronóstico» queda disponible, el modelo estadístico necesita **6 periodos terminados** y la estimación simple 3. Con la historia de la demo se pueden mirar «Esperado» y «Rango probable (80 %)» (TC-FORECAST-EXPENSE-015). Si se habilita, repetí la medición de memoria de la fase 7.

## 15. Documentos cifrados

Requiere el registro DNS de `files.<dominio>` y `pfos-bootstrap-storage.sh` ([documentos-llavero-y-subida.md](../runbooks/documentos-llavero-y-subida.md)).

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-DOC-01 | Abrir un gasto → «Adjuntos» → «Adjuntar un archivo» → un PDF inventado (por ejemplo «ticket-prueba.pdf») | Progreso «Calculando la suma de verificación del archivo…» → «Subiendo el archivo: N %» → «Verificando el archivo…» → «Adjuntando…»; aparece con «Descargar» | Sí | TC-DOCUMENTS-ATTACH-022 |
| GF-DOC-02 | «Descargar» y comparar con el original | Mismos bytes (mismo tamaño y mismo hash) | Sí | TC-DOCUMENTS-ATTACH-022 |
| GF-DOC-03 | Renombrar un PNG a `factura.pdf` y adjuntarlo | «El archivo «factura.pdf» fue rechazado: su contenido no coincide con su tipo. No se adjuntó.» | No | TC-DOCUMENTS-ATTACH-022 |
| GF-DOC-04 | «Quitar» el adjunto → **Documentos** | Sigue en la lista sin vínculo; uso «Usas … de 5 GB»; aviso de eliminación a los 30 días | No | TC-DOCUMENTS-ATTACH-022 |
| GF-DOC-05 | «Archivar», «Desarchivar» y «Eliminar» | El diálogo de eliminación avisa que es irrecuperable; después no se puede descargar | No | TC-DOCUMENTS-ATTACH-022 |
| GF-DOC-06 | En Git Bash, con `FILES` definido (§0.2): `curl -s -o /dev/null -w "%{http_code}\n" $FILES/` | `404`: el almacenamiento no se lee sin firma | Sí | ADR-0030 |

## 16. Notificaciones y email

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-NOT-01 | Con la línea de Restaurantes de 600,00 (GF-PLA-02), registrar gastos hasta 550,00 | La campana suma 1; la bandeja dice «Restaurantes … 550,00 de 600,00 BOB» | No | TC-NOTIFICATIONS-INAPP-001 |
| GF-NOT-02 | «Ver la línea en el plan de {periodo}» | Abre «Presupuestos» con la línea resaltada | No | TC-NOTIFICATIONS-INAPP-001 |
| GF-NOT-03 | Detalle de la notificación | «Email: Suprimido» (`EMAIL_DRIVER=none` en N1) | No | [notification-email.md](../runbooks/notification-email.md) |
| GF-NOT-04 | **Mis preferencias** → «Notificaciones»: apagar «Email» de un tipo, «Horario de silencio» 22:00–07:00 → «Guardar» | «Preferencias de notificaciones guardadas.»; queda en la auditoría | No | TC-NOTIFICATIONS-PREFS-001, TC-NOTIFICATIONS-PREFS-003 |
| GF-NOT-05 | Horario de silencio con inicio igual al fin | «La hora de inicio y la de fin deben ser distintas.» | No | TC-NOTIFICATIONS-PREFS-003 |

Con un proveedor de email elegido (decisión pendiente, D87), el asunto esperado del caso GF-NOT-01 es «Tienes una alerta de presupuesto», sin montos ni nombres.

## 17. Export y restore del workspace

En «GF Pruebas». No uses la demo: un export de un workspace demo no se puede restaurar (`EXPORT_FORMAT_UNSUPPORTED`).

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-EXP-01 | Anotar saldos de 3 cuentas y el número de transacciones de «Banco Tres Meses» | Línea base para comparar | Sí | — |
| GF-EXP-02 | **Configuración** → «Exportar este espacio de trabajo» → «Sí, exportar» (si pide «Confirmar mi identidad», volver a iniciar sesión) | Estado «Lista» con vencimiento a 7 días | Sí | TC-IDENTITY-EXPORT-001, TC-IDENTITY-EXPORT-005 |
| GF-EXP-03 | «Descargar»; en PowerShell, `cd "$env:USERPROFILE\Downloads"` y después `Get-FileHash pfos-export-*.zip -Algorithm SHA256` | Coincide con el SHA-256 de la lista. Guardá el ZIP fuera del repositorio: está en claro | Sí | TC-IDENTITY-EXPORT-006 |
| GF-EXP-04 | «Importar un archivo exportado» → el ZIP → «Importar» | «Validando…» → «Importando…» → «Verificando saldos y balance…» → «Completada»; «Abrir el espacio de trabajo nuevo» | Sí | TC-IDENTITY-RESTORE-001 |
| GF-EXP-05 | En «GF Pruebas (restaurado)», comparar con GF-EXP-01 | Mismos saldos y mismo número de transacciones; «GF Pruebas» sigue igual | Sí | TC-IDENTITY-RESTORE-001, TC-IDENTITY-RESTORE-002 |
| GF-EXP-06 | En la demo: «Limpiar datos de demostración» → «Sí, limpiar» | Desaparece del selector; los datos de «GF Pruebas» no cambian | Sí | TC-IDENTITY-DEMO-004 |

Detalle y errores: [restaurar-workspace-desde-export.md](../runbooks/restaurar-workspace-desde-export.md).

## 18. Idiomas es, en y pt

| ID | Pasos | Esperado | Bloq. | Respaldo |
|---|---|---|---|---|
| GF-I18N-01 | Menú de la cuenta → «Idioma» → «English (United States)» | La URL pasa a `/en/…` y la interfaz a inglés | No | TC-IDENTITY-AUTH-008 |
| GF-I18N-02 | «Português (Brasil)» | `/pt/…` y la interfaz en portugués | No | TC-IDENTITY-AUTH-008 |
| GF-I18N-03 | **Mis preferencias** → «Idioma» = en-US → «Guardar preferencias»; cerrar sesión y volver | Entra en inglés («My preferences», «Preferences saved.») | No | TC-IDENTITY-AUTH-008 |
| GF-I18N-04 | Volver a es-BO | Ruta sin prefijo y «Preferencias guardadas.» | No | TC-IDENTITY-AUTH-008 |
| GF-I18N-05 | En inglés y en portugués, abrir Inicio, Transacciones y Reportes | Ningún texto sin traducir ni claves crudas (`App.…`) | No | `apps/web/src/i18n.test.ts` (catálogos es, en y pt con las mismas claves; sin TC) |
| GF-I18N-06 | Abrir Inicio en el teléfono | Se lee sin scroll horizontal | No | TC-REPORTING-REPORTS-026 |

## 19. Pruebas de operación

No duplican el runbook: cada una enlaza la sección que la ejecuta. Son parte de la fase 7 del [runbook de despliegue](RUNBOOK-DESPLIEGUE.md#fase-7-poc-de-48-h-con-datos-ficticios-vos-y-claude).

| ID | Prueba | Cómo | Esperado | Bloq. |
|---|---|---|---|---|
| GF-OPS-01 | Despliegue de una versión nueva por digest | [deploy-and-restore §3](../runbooks/deploy-and-restore.md#3-deploys-siguientes) con un SHA de `main` en verde | El job termina en verde; `action=status` muestra el SHA; las comprobaciones 1 a 6 de la fase 6 coinciden | Sí |
| GF-OPS-02 | Vuelta atrás | [deploy-and-restore §4](../runbooks/deploy-and-restore.md#4-rollback-por-digest) con `action=rollback` | Vuelve al release anterior; GF-ACC-01 y GF-CTA-01 siguen funcionando con los mismos datos | Sí |
| GF-OPS-03 | Respaldo | `systemctl start pfos-backup@full.service` y [§7](../runbooks/deploy-and-restore.md#7-operación-diaria) | `journalctl -u pfos-backup@full` sin error; `pgbackrest info` lista el full | Sí |
| GF-OPS-04 | Restore PITR de prueba | Paso 5 de la fase 7 del [runbook](RUNBOOK-DESPLIEGUE.md#fase-7-poc-de-48-h-con-datos-ficticios-vos-y-claude), con [§6](../runbooks/deploy-and-restore.md#6-restore-drill-mensual-primer-lunes-de-cada-mes) en la VM de drill | Aparece la transacción anterior a T y no la posterior; integridad en 0; RTO < 1 h | Sí |
| GF-OPS-05 | Reinicio del host | `sudo reboot` (paso 8 de la tabla de la fase 7) | Todo vuelve solo; §0.2 en verde; los saldos de GF-EXP-01 iguales | Sí |
| GF-OPS-06 | Memoria y CPU durante el import de 5 000 filas | Generar el archivo (abajo), importarlo en una cuenta nueva y mirar `docker stats --no-stream` y `/var/log/pfos-poc-mem.log`. La persistencia se mide con la medición 3 y los créditos con la medición 2 de la [regla de corte del runbook](RUNBOOK-DESPLIEGUE.md#cómo-se-mide-cada-señal-de-cpu-y-de-latencia) | Termina `COMPLETED` con 5 000 creadas; `MemAvailable` ≥ 15 % de `MemTotal`; ningún contenedor con `OOMKilled=true`; persistencia dentro del umbral de C14 (≤ 20 s con créditos, ≤ 60 s sin créditos). Si lo cruza, es un corte por CPU según la [regla de corte](RUNBOOK-DESPLIEGUE.md#poc-de-48-h-regla-de-corte) | Sí |
| GF-OPS-07 | Reimport de las 5 000 | Importar el mismo archivo otra vez | 5 000 «ya importadas», 0 creadas | Sí |

**Archivo de 5 000 filas ficticias** (TC-IMPORTS-CSV-029; el repositorio no lo versiona). Generalo **fuera del repositorio**, por ejemplo en el escritorio, con **PowerShell 7** (`pwsh`). Windows PowerShell 5.1 no acepta `utf8NoBOM`, y su `-Encoding utf8` agrega un BOM:

```powershell
$hoy = Get-Date
$lineas = [System.Collections.Generic.List[string]]::new()
$lineas.Add('Fecha,Descripcion,Monto')
for ($i = 1; $i -le 5000; $i++) {
  $fecha = $hoy.AddDays(-(($i % 150) + 1)).ToString('yyyy-MM-dd')
  $monto = 5 + ($i % 97)
  $lineas.Add("$fecha,MOVIMIENTO SINTETICO $i,-$monto.00")
}
$lineas | Set-Content -Encoding utf8NoBOM "$env:USERPROFILE\Desktop\gf-5000.csv"
```

Importalo en una cuenta BOB con saldo inicial 500.000 y mapeo: fecha `yyyy-MM-dd`, descripción col. 2, monto col. 3 «negativo es salida», decimal «.». Si el mes de alguna fecha está cerrado (GF-CIE-04), esas filas fallan con `PERIOD_CLOSED`: usá una cuenta y un rango sin cierres, o reabrí el periodo.

**Si algo falla, dónde mirar:**

- Logs: Grafana Cloud (OTLP) o, en el host, `$C logs --since 1h finance-api finance-worker keycloak` (alias `$C` del [runbook de despliegue](RUNBOOK-DESPLIEGUE.md#valores-que-vas-a-necesitar)). Los logs no llevan montos ni descripciones; buscá por `requestId` (lo muestran los errores de la UI) o por `importJobId`.
- Import trabado en `PERSISTING`: [importar-extracto-csv §4](../runbooks/importar-extracto-csv.md#4-operación-y-diagnóstico).
- Memoria: `docker stats`, `free -m`, `vmstat 5`; `docker inspect -f '{{.State.OOMKilled}}' <contenedor>`.
- Tasas: [fx-provider-caido.md](../runbooks/fx-provider-caido.md). Email: [notification-email.md](../runbooks/notification-email.md). Documentos: [documentos-llavero-y-subida §5](../runbooks/documentos-llavero-y-subida.md#5-diagnóstico).
- Síntomas conocidos: «Problemas frecuentes» del [runbook de despliegue](RUNBOOK-DESPLIEGUE.md#problemas-frecuentes).

## Criterio de aprobación

**Se pueden cargar datos reales** cuando:

1. Todos los casos con `Bloq. = Sí` dan OK, incluidos los siete de operación (GF-OPS-01 a 07).
2. La fase 7 del runbook terminó (48 h sin cruzar ningún umbral de la regla de corte, incluidos los de CPU de C14).
3. Ningún caso, bloqueante o no, mostró datos de otro usuario o de otro workspace. Eso corta todo, aunque el caso sea `No`.

Los casos con `Bloq. = No` que fallen se anotan y se abren como defectos; no frenan la carga. Por área:

| Bloquean | No bloquean |
|---|---|
| Acceso y aislamiento, cuentas, transacciones y splits, transferencias y conversiones, reglas básicas, import CSV y OFX con reimport en 0, presupuestos, cierre de mes, compromisos, préstamos, adjuntos y su descarga, export y restore, los 15 reportes abriendo, operación | Rechazos de PDF, perfiles y conexiones, sugerencias de reglas y de presupuesto, tarjetas, metas, flujo de caja, pronósticos, notificaciones y email, inglés y portugués, vistas guardadas |

Después de aprobar: borrá los datos ficticios como dice la fase 7 del runbook y volvé `DEMO_DATA_ENABLED` a `false`.

## Lo que esta guía no cubre: criterios de salida con datos reales

Se hacen en producción, con tus datos, y **nunca entran al repositorio** (solo conteos o resultados, como pide cada tarea). Estado en [docs/38 §2](../38-estado-y-pendientes.md#2-esperan-al-owner).

| Fase | Criterio | Qué registrar |
|---|---|---|
| 2 | Cerrar un mes real con todas las cuentas conciliadas (`add-month-closing` 7.4, TC-PLANNING-EXIT-001) | Fecha del cierre y versión |
| 2 | Exportar e importar tu workspace real | Que los saldos coinciden |
| 3 | Registrar tus suscripciones reales y pasar un mes sin recurrentes sorpresa | El indicador de **Pagos próximos** |
| 4 | Cargar la tabla de amortización real de tu préstamo y comparar (`add-loans` 8.4, D154) | `MATCH` o `EXPLAINED` |
| 4 | Tus metas con estado calculado | Que el estado se calcula |
| 5 | Ventana de 30 días en N1 (D248) | Inicio y fin |
| 5 y 6 | Exchanges reales: términos de Binance y Bybit, exportaciones de historial y clave de solo lectura (changes 38 y 56) | Fecha, URL y resultado en ADR-0031 |
| 6 | Importar 3 meses de extractos reales y medir `ruleCoverage` ≥ 0,7000 (`add-rule-engine` 7.5) | Fecha, rango y `ruleCoverage` |
| 6 | Correr `pnpm imports:pdf:probe` sobre extractos reales de BCP, Ganadero y BNB y reimportar un mes con 0 nuevas (`add-pdf-statement-parser` 9.1 y 9.4) | Solo la salida estructural |
| 6 | Instituciones de Bolivia: listados de ASFI y BCB, formatos de exportación y un extracto de BISA (change 41) | Lo pedido en la tarea 1.1 |
| 8 | Habilitar pronósticos con ≥ 6 periodos terminados y `pnpm forecast:backtest:report`; el change 67 espera 3 periodos con pronóstico real | El informe del backtest |

## Preguntas abiertas

Las preguntas que dependen de vos están consolidadas en [docs/71](../71-despliegue-n1-questions.md) y se responden en la fase 1 del runbook. Las que tocan esta guía son la 5 (datos demo durante el PoC; si no se habilitan, ver [§0.4](#04-si-la-demo-no-se-habilita)) y la 6 (lectura de un PDF que cuadra). El umbral del import de 5 000 filas en el host ya no es una pregunta: es la regla de corte de CPU de C14 (GF-OPS-06).
