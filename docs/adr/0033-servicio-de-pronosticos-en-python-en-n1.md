# ADR-0033: Servicio de pronósticos en Python: contenedor, contrato y despliegue en N1

- Estado: **Aceptado** (2026-11-12, D410 en [docs/66](../66-phase-8-consolidation-decisions.md))
- Fecha: 2026-11-12
- Decisores: Owner (Product/Tech Lead)
- Relacionado: concreta [ADR-0017](0017-ml-service-separation.md) (propuesto: servicio Python separado, fuera del camino crítico); [ADR-0027](0027-destino-de-despliegue-inicial-vps-compose.md) (N1 Lightsail 2 GB + Compose); ADR-0011 (imágenes), ADR-0018 (versiones fijadas), ADR-0020 (observabilidad), ADR-0023 (RLS); docs/15-ml-architecture.md; docs/20 §3.2 y §4.3; `openspec/changes/add-ml-forecasting-service` (decisiones 2–5, 21 y 22); D249 (presupuesto de conexiones); OpenSpec capability `forecast/expense-forecasting`

## Contexto y problema

ADR-0017 propuso un servicio Python separado para el pronóstico, con un ACL en el monolito, y docs/15 lo detalló con un snapshot del conjunto de datos en Object Storage y un job asíncrono con polling dentro del servicio. Ninguno de los dos fue aceptado, y desde entonces cambiaron tres cosas: el despliegue es un único host N1 de 2 GB (ADR-0027) con 1.3–1.6 GiB usados en reposo; el presupuesto de conexiones está cerrado (API 22 + worker 34 sobre `max_connections=70`, D249, sin consumidores nuevos); y el owner, único usuario, todavía no tiene 6 periodos de historia. Phase 8 necesita decidir cómo se empaqueta, cómo se habla y cómo se despliega el servicio sin que el núcleo dependa de él y sin romper el presupuesto de memoria cuando no se usa.

## Drivers de decisión

- El núcleo funciona igual sin el servicio (ARCHITECTURE §1–§2, FR-FORECAST-006, NFR-REL-010).
- Calidad estadística: suavizado exponencial y backtesting con herramientas estándar.
- Memoria y CPU del host N1 de 2 GB; costo cero cuando la función está apagada.
- Cero consumidores y cero conexiones a PostgreSQL nuevas.
- Privacidad: los datos financieros no salen del host ni a terceros (NFR-COMP-001).
- Un solo operador: pocas piezas, misma cadena de imágenes por digest (NFR-PORT-006).

## Opciones consideradas

1. **Servicio Python síncrono y sin estado, opcional por perfil** (FastAPI, un proceso, statsmodels).
2. Servicio Python con job asíncrono interno y snapshot en Object Storage (docs/15 §2–§3).
3. Pronóstico en TypeScript dentro del worker (naive, promedios y un ETS propio).
4. Proceso Python efímero lanzado por el host (temporizador de systemd) que lee un snapshot y escribe resultados.
5. Servicio de ML gestionado (SageMaker, Vertex AI).

## Decisión

**Opción 1.** En detalle:

- **Contenedor `finance-ml`** (`docker/finance-ml.Dockerfile`): Python 3.14 si numpy, scipy y statsmodels publican wheels estables para esa versión al implementar (si no, 3.13), base `slim` de Debian fijada por digest, dependencias con `uv` y `uv.lock` (numpy, scipy, pandas, statsmodels, FastAPI, uvicorn, pydantic; todas BSD/MIT, NFR-COMP-003), sin Prophet, Polars, scikit-learn ni MLflow en Phase 8. Usuario 10001, sistema de archivos de solo lectura con `tmpfs /tmp`, `cap_drop: [ALL]`, `no-new-privileges`. **Un proceso uvicorn**, una petición a la vez (la segunda recibe `503` con `Retry-After`), `OMP_NUM_THREADS`/`OPENBLAS_NUM_THREADS`/`MKL_NUM_THREADS` = 1.
- **Contrato**: `POST /v1/forecasts` síncrono con el conjunto de datos **en el cuerpo** (≤ 2 MiB; un workspace personal pesa decenas de KB) y los resultados en la respuesta; JSON Schema en `contracts/ml/` y OpenAPI en `contracts/openapi/ml-forecasting.v1.yaml`, verificados en el CI de ambos lados con ejemplos compartidos; solo cambios aditivos dentro de `/v1`. Montos como string decimal; el servicio cuantiza con `Decimal` y `ROUND_HALF_EVEN`. Corte interno a los 240 s; el worker espera hasta 300 s.
- **Sin estado y sin datos**: sin credenciales de PostgreSQL ni de almacenamiento de objetos; no guarda peticiones; registra solo tamaños, duración, versión y resultado. La reproducibilidad es `datasetSnapshotId` (hash SHA-256 del JSON canónico) + versión de modelos + semilla.
- **Minimización**: referencias opacas por corrida (`s1..sN`), sin id del workspace, nombres, descripciones, contrapartes ni ids de transacciones.
- **Red y credencial**: red Compose `ml-internal` con `internal: true` (sin salida a Internet) compartida solo con el worker; credencial de servicio aleatoria de 32 bytes en un archivo 0400 montado en el servicio y en el worker, enviada como `Bearer` y comparada en tiempo constante. La API y el navegador no alcanzan el servicio.
- **Integración**: la asincronía la da la corrida en el worker (`forecasting.forecast_run`, trabajos `forecasting.schedule` y `forecasting.runner` dentro de la reserva de trabajos periódicos); ninguna conexión a PostgreSQL queda tomada durante la llamada al servicio; reintentos con espera creciente (5 intentos en 24 h). Cero consumidores y cero conexiones nuevas.
- **Local**: perfil Compose `ml`, puerto 8090 publicado solo en `127.0.0.1:${PF_ML_PORT:-28090}`; el perfil `core` no depende del servicio.
- **Despliegue en N1**: el servicio entra en `compose.prod.yaml` dentro del perfil `ml`, **deshabilitado por omisión**. El owner lo habilita con `COMPOSE_PROFILES=ml`, `FORECASTING_ENABLED=true` y la credencial en `/etc/pfos/ml-service-token`; recomendación: hacerlo cuando su historia cumpla la preparación de datos (≥ 6 periodos). Límite inicial `cpus: '1', memory: 320m`, a medir en la tarea 4.8 del change 64 (estimación: 150–200 MiB en reposo con statsmodels cargado). `main.yml` construye, escanea (Trivy, mismo criterio) y publica la imagen con SBOM; `deploy.yml` y el comando forzado del host aceptan el digest opcional `FINANCE_ML_IMAGE`. Solo amd64 en Phase 8 (N1-F en ARM requeriría multi-arch, NFR-PORT-008).
- **Disparador nuevo** (se suma a los de ADR-0027): con el servicio habilitado, memoria del host > 85 % sostenida u OOM del servicio ⇒ N2, o deshabilitar el perfil.

## Análisis de opciones

### 1. Servicio Python síncrono y sin estado, opcional (elegida)
- **Pros:** ecosistema estándar (statsmodels) para ETS y backtesting; aislamiento de fallos y de CPU; sin estado que perder al reiniciar; sin credenciales de datos; costo cero deshabilitado; mismo flujo de imágenes por digest.
- **Contras:** segundo lenguaje y toolchain (uv, ruff, mypy, pytest); un contrato más; con el servicio habilitado, ~150–200 MiB más en un host de 2 GB.
- **Costo:** USD 0 extra en N1 si la memoria alcanza; si no, N2 (≈ USD 27–30/mes, ADR-0027).

### 2. Job asíncrono interno + snapshot en Object Storage (docs/15)
- **Pros:** desacopla tamaño del conjunto y duración de la petición.
- **Contras:** el servicio guardaría estado (jobs) que se pierde al reiniciar o duplicaría el estado de la corrida; necesitaría credenciales de almacenamiento y una política de expiración; más superficie para datos de un usuario que caben en una petición.

### 3. TypeScript en el worker
- **Pros:** sin runtime nuevo ni contenedor; sin red interna.
- **Contras:** sin implementación madura de ETS con intervalos ni backtesting estándar; el cómputo numérico bloquea el event loop del worker (que tiene 448 MiB y 28 consumidores); mantener estadística propia es deuda; contradice ADR-0017.

### 4. Proceso efímero por temporizador del host
- **Pros:** cero memoria fuera de la ventana de cómputo.
- **Contras:** el worker no puede lanzarlo sin el socket de Docker (riesgo inaceptable); necesitaría leer y escribir datos por fuera del ACL (dos escritores del schema, docs/15 §2.1 opción B) o un intercambio de archivos; las solicitudes manuales esperarían a la ventana.

### 5. ML gestionado
- **Contras:** costo desproporcionado, datos financieros a un tercero, lock-in (ADR-0017 ya la descartó).

## Consecuencias

**Positivas**
- El núcleo no cambia de comportamiento con el servicio apagado; deshabilitado no cuesta memoria.
- El presupuesto de conexiones y de consumidores queda intacto.
- Un contrato simple y verificable en ambos lados.

**Negativas**
- Mantener una cadena Python (dependencias, CVE, Renovate con el gestor `pep621`).
- Un check de CI más (el job `ml`); hacerlo obligatorio requiere la confirmación del owner (pregunta 10 de docs/65).
- Con el servicio habilitado, el margen de memoria de N1 se achica.

**Riesgos**
- Memoria de N1 → opt-in, límite medido, disparador a N2.
- Montos enviados a un proceso interno → red sin salida, referencias opacas, sin persistencia ni registros con montos.
- Determinismo numérico → semilla, un hilo BLAS, versiones fijadas, cuantización a la escala de la moneda.

## Validación

- Test de degradación de punta a punta: stack sin el perfil `ml` y con la función habilitada; el núcleo responde y la corrida termina `FAILED` tras los reintentos (TC-FORECAST-SERVICE-001, -029).
- Test del presupuesto de conexiones con la función habilitada (TC-FORECAST-SERVICE-010, TC-PLATFORM-THROUGHPUT-009).
- Medición de memoria del servicio en reposo y durante una corrida del conjunto Large (tarea 4.8 del change 64), registrada en este ADR.
- Benchmark nocturno: corrida completa ≤ 300 s (NFR-PERF-012, TC-FORECAST-SERVICE-028).

## Notas

- Versiones de Python, numpy, scipy, pandas y statsmodels: a verificar al implementar (no se consultaron fuentes externas en esta propuesta).
- Si se acepta, ADR-0017 pasa a «Aceptado» con esta concreción.

## Nota as-built: `add-ml-forecasting-service` (Phase 8, 2026-11-12)

- Medición (tarea 4.8, 2026-11-12, imagen `finance-ml` construida del Dockerfile, contenedor `read_only`, `-m 320m --cpus 1`): reposo 48 MiB; tras una petición de 400 series × 60 periodos × horizonte 12 (197 KB) responde en 0,14 s y el contenedor queda en 56 MiB. Con los baselines de este change `statsmodels` no se importa; el límite de 320 MiB deja margen para ETS (change 65, que vuelve a medir).
