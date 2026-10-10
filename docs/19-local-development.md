# 19 — Entorno de desarrollo local

> **Estado:** Aceptado — implementado en Phase 0 (`bootstrap-platform-foundation`); secciones marcadas **as-built (2026-10-02)** · **Fecha:** 2026-10-01 (diseño) / 2026-10-02 (as-built) · **Relacionado:** [ARCHITECTURE.md](ARCHITECTURE.md) §6, §10, §11, §15 · [07-c4-architecture.md](07-c4-architecture.md) · [12-security.md](12-security.md) · [16-testing-strategy.md](16-testing-strategy.md) · [18-observability.md](18-observability.md) · [20-container-strategy.md](20-container-strategy.md) · [23-ci-cd.md](23-ci-cd.md) · [29-seed-datasets.md](29-seed-datasets.md) · [30-backup-and-disaster-recovery.md](30-backup-and-disaster-recovery.md) · [config-reference.md](config-reference.md) · ADR-0011, ADR-0012 · Spec: `openspec/changes/bootstrap-platform-foundation/specs/platform/local-environment/spec.md` · SPIKE-07, SPIKE-08

> **As-built (2026-10-02).** Lo que en Phase 0 era ilustrativo ya existe como ficheros reales, que son la **fuente de verdad**: [`deploy/compose/compose.yaml`](../deploy/compose/compose.yaml), [`.env.example`](../.env.example), los scripts de [`scripts/stack/src/`](../scripts/stack/src/) (paquete `@pf/stack`), el realm [`deploy/compose/keycloak/realm-pfos-dev.json`](../deploy/compose/keycloak/realm-pfos-dev.json) y el esquema de configuración de [`packages/platform/src/config/`](../packages/platform/src/config/) (referencia generada: [config-reference.md](config-reference.md)). Este documento ya no duplica esos ficheros: los resume y conserva el análisis y las decisiones. Todos los comandos de §0.5 y §3 se verificaron tal cual en Windows 11 con PowerShell 7 y Git Bash (Node 22.23, pnpm 12.4.2, Docker Compose v5.5.1).

---


> **Hallazgos de SPIKE-08 (2026-10-02) que prevalecen sobre este documento:** (1) puertos de host configurables `PF_<SVC>_PORT` con defaults "2 + puerto canónico" (25432, 26379, 28080, 23000, 28081, 28025/21025, 29000/29001) y `PF_BIND_ADDR=127.0.0.1` — los canónicos chocan con otros proyectos en la máquina del owner y el rango 61xxx cae en puertos efímeros de Windows; (2) **modo principal de desarrollo: apps en el host Windows** (`node --watch` recarga en ~267 ms) con el perfil `deps` en contenedores — el bind mount desde `D:` no dispara file watching nativo y el polling cuesta 20–50 % de CPU; hot reload dentro de contenedores / Dev Containers solo con el repo en el filesystem de WSL2 y la integración WSL de Docker Desktop activada (decisión del owner); (3) `init: true` + entrypoint en forma exec + handler de SIGTERM son obligatorios (sin init: zombies y exit 137); (4) `db:seed` usa `docker compose --profile core run --rm seed`, no `up --wait`; (5) `.gitattributes` con `eol=lf` es imprescindible porque `core.autocrlf=true` rompe los entrypoints `.sh`; (6) Docker 29 rechaza `start_interval` sin `start_period`. Evidencia: [spikes/SPIKE-08-compose-windows](../spikes/SPIKE-08-compose-windows/README.md).

## 0. Estrategia de dockerización y parametrización (decisión del owner, 2026-10-02)

> **Prevalece sobre el resto del documento** donde haya diferencias. Origen: aceptación de ADR-0012 tras SPIKE-08 — repo en `D:`, apps en Windows durante el desarrollo, **con dockerización y parametrización claras desde el primer commit**.

### 0.1 Principio rector

**Un solo contrato de configuración, dos modos de ejecución, las mismas imágenes en todos los entornos.** Lo único que cambia entre el modo host, el modo contenedor, CI, staging y producción son los **valores** de las variables de entorno — nunca el código, nunca la imagen.

### 0.2 Modos de ejecución

| Modo | Para qué | Qué corre en contenedores | Qué corre en el host | Comando |
|---|---|---|---|---|
| **A — Host** (por defecto al desarrollar) | Ciclo rápido de edición: `node --watch` recarga en ~267 ms | Perfil `deps`: `postgres`, `object-storage`, `mailpit`, `keycloak` | `finance-api`, `finance-worker`, `finance-web` (Node en Windows) | `pnpm stack:up` (deps) + `pnpm dev` |
| **B — Contenedor completo** | Paridad con producción: tests de integración/E2E, demo, verificar Dockerfiles | Perfil `core`: deps + `migrate` + `finance-api` + `finance-worker` + `finance-web` | Nada (solo el navegador) | `pnpm stack:up -- --profile core` |
| CI | Quality gate | Igual que B (imágenes construidas una sola vez por commit) | Runner | workflows |
| Staging / Prod | Ejecución real | Mismas imágenes por digest | — | pipeline |

Regla: **todo PR debe pasar en modo B** (CI lo ejecuta). Un desarrollador puede trabajar solo en modo A, pero no puede introducir nada que funcione únicamente en modo A.

### 0.3 Contrato de configuración

1. **Esquema único por app** en `packages/platform/src/config/` (zod), validado al arrancar: si falta o es inválida una variable, el proceso **termina con error** listando todas las faltantes (fail-fast). Ningún módulo lee `process.env` directamente.
2. **Referencia generada:** `docs/config-reference.md` se genera desde el esquema (`pnpm config:docs`) y CI falla si está desactualizada.
3. **Dos familias de variables:**

| Familia | Prefijo | Quién la lee | Ejemplos |
|---|---|---|---|
| Plataforma local (solo Compose / scripts) | `PF_` | `compose.yaml`, `scripts/*.ts` | `PF_BIND_ADDR=127.0.0.1`, `PF_POSTGRES_PORT=25432`, `PF_OBJECT_STORAGE_PORT=29000`, `PF_KEYCLOAK_PORT=28081`, `PF_MAILPIT_UI_PORT=28025`, `PF_API_PORT=28080`, `PF_WEB_PORT=23000`, `PF_COMPOSE_PROFILES` |
| Runtime de la aplicación | sin prefijo, por dominio | apps (vía esquema) | `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `JOB_QUEUE_DRIVER`, `SESSION_STORE`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE=es-BO`, `APP_REPORTING_CURRENCY=BOB`, `APP_TIMEZONE=America/La_Paz` (lista completa as-built: [config-reference.md](config-reference.md); las variables `OIDC_*` de la app y `SMTP_*` llegan con los changes de identidad y notificaciones) |

4. **Un solo `.env` en la raíz** (copiado de `.env.example`), leído por Compose y por los procesos del host. Los valores del `.env` son los del **modo A** y se derivan de los puertos `PF_*` por interpolación:
   ```dotenv
   PF_POSTGRES_PORT=25432
   DATABASE_URL=postgres://pf_app:${PF_DEV_DB_APP_PASSWORD}@${PF_BIND_ADDR}:${PF_POSTGRES_PORT}/pfos?sslmode=disable
   OBJECT_STORAGE_ENDPOINT=http://${PF_BIND_ADDR}:${PF_OBJECT_STORAGE_PORT}
   ```
5. **Modo B sobrescribe solo las direcciones** en el bloque `environment:` de cada servicio de `compose.yaml` (nombres de servicio y puertos internos canónicos): `DATABASE_URL=postgres://pf_app:${PF_DEV_DB_APP_PASSWORD}@postgres:5432/pfos?sslmode=disable`, `OBJECT_STORAGE_ENDPOINT=http://object-storage:8333`. El resto de variables se hereda del mismo `.env` → no hay dos configuraciones que mantener.
6. **Toggles de dependencias**, no ramas de código: `JOB_QUEUE_DRIVER=pgboss|bullmq`, `SESSION_STORE=postgres|valkey`, `OTEL_ENABLED=true|false`, `OTEL_NODE_RESOURCE_DETECTORS=env,os,serviceinstance` (obligatorio, SPIKE-10). El adapter se elige en el composition root; el dominio no se entera.
7. **Secretos:** `.env.example` solo contiene placeholders de desarrollo marcados `PF_DEV_*` (generados por `pnpm setup:env` con valores aleatorios en el primer arranque). Nunca en imágenes, nunca en el repo; en cloud se inyectan desde el secrets manager como variables con el **mismo nombre**. Incluye `PF_DEV_EXPORT_MASTER_KEY`, la clave maestra de prueba del cifrado de exports (`EXPORT_ENCRYPTION_KEYS=dev1:…`); en cloud viene del secrets manager o KMS.
8. **Sin `localhost` en el código:** toda dirección viene del esquema. `localhost`/`127.0.0.1` solo aparece como *valor* en `.env.example` (modo A).

### 0.4 Dockerización

- **Una imagen por desplegable**, multi-stage, target `runtime` non-root: `finance-api` (comandos `api | worker | migrate | seed`), `finance-web`, `finance-ml` (Phase 8). **No existen Dockerfiles de desarrollo**: el modo B usa la imagen de producción.
- Todos los contenedores de app: `init: true`, `ENTRYPOINT` en forma exec, handler de SIGTERM, `stop_grace_period`, healthcheck sobre `/health/ready` (SPIKE-08).
- Imágenes de terceros fijadas por versión **y digest** (p. ej. SeaweedFS `mini`, SPIKE-07); prohibidas imágenes Bitnami.
- Profiles: `deps`, `core`, `seed`, `observability`, `ml` y **`valkey`** (solo si `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey`; ya no forma parte de `deps`/`core`).
- Todos los puertos publicados en `${PF_BIND_ADDR}:${PF_<SVC>_PORT}`; dentro de la red Compose se usan los puertos canónicos.
- Volúmenes nombrados por proyecto (`pfos_pg-data`, `pfos_object-storage-data`, …) y red `pfos_default`; nombre de proyecto Compose fijo `pfos` para no mezclarse con otros proyectos de la máquina (los scripts solo operan sobre `-p pfos`).
- Futuro opcional (no implementado): `compose.dev.yaml` con `develop.watch` para quien mueva el repo a WSL2 (no es el camino principal).

### 0.5 Comandos — as-built (2026-10-02)

Scripts TypeScript ejecutados con `tsx` vía `pnpm` (fuentes en `scripts/stack/src/`, scripts en el `package.json` raíz). `docker` se invoca con `spawn` y `shell: false`: mismo comportamiento en PowerShell, cmd y Git Bash (sin conversión de rutas MSYS). Los argumentos van tras `--` (`pnpm stack:up -- --profile core`); el parser ignora ese separador. Todos usan el proyecto Compose `pfos` y el `.env` de la raíz.

| Comando | Modo | Efecto |
|---|---|---|
| `pnpm setup:env [-- --force] [--apply-ports] [--check]` | — | Crea o actualiza `.env` desde `.env.example`: cada `__generate__` se reemplaza por un secreto aleatorio; los valores de un `.env` existente se **conservan** (solo `--force` regenera). Comprueba que los puertos `PF_*_PORT` estén libres (también los rangos reservados por Windows) y sugiere alternativas; `--apply-ports` las escribe; `--check` solo informa (exit 3 si hay conflicto). Nunca imprime secretos. |
| `pnpm stack:up [-- --profile <p>…] [--build] [--timeout=420]` | A / B | `docker compose up -d --wait --remove-orphans`; perfil por defecto `deps` (o `PF_COMPOSE_PROFILES`). Imprime las URLs. Si `migrate` falla, muestra su log y no arrancan api/worker. |
| `pnpm stack:up -- --profile core` | B | Producto completo en contenedores con las imágenes `pfos/finance-*:local` (añadir `--build` o `pnpm images:build` para reconstruirlas). |
| `pnpm dev [-- --skip-migrate]` | A | Exige `deps` healthy; ejecuta `migrate` en el host y arranca api y worker (`tsx watch`) y web (`next dev`) con salida prefijada `[api]`/`[worker]`/`[web]`. Ctrl+C detiene los tres. |
| `pnpm stack:down [-- --volumes --yes]` | A / B | `compose down --remove-orphans` (todos los perfiles); conserva volúmenes salvo `--volumes` (pide confirmación). |
| `pnpm stack:ps` · `pnpm stack:restart [-- <svc>…]` · `pnpm stack:logs [-- <svc>…] [--follow] [--tail=N] [--since=10m]` | A / B | Estado/health, reinicio y logs (`logs` sigue la salida por defecto solo en terminal interactiva). |
| `pnpm stack:reset [-- --seed=minimal\|none] [--profile core] [--yes]` | A / B | Solo con `PFOS_ENV=local\|ci`: `down --volumes` → `up` → `migrate` → seed (§8.1). |
| `pnpm db:migrate [-- --host]` | A / B | `migrate` en contenedor (`compose run --rm migrate`); `--host` lo ejecuta con el build local de `apps/api`. |
| `pnpm db:seed [-- --profile=minimal] [--host]` | A / B | `compose --profile core run --rm seed seed --profile=…` (one-shot, nunca dentro de `up --wait`). |
| `pnpm images:build` | B | Construye `pfos/finance-api:local` y `pfos/finance-web:local`. |
| `pnpm backup:local [-- --name=<etiqueta>]` · `pnpm restore:local -- <id\|latest> [--yes] [--with-keycloak]` | A / B | Backup/restore local (§9). |
| `pnpm check:hosts` | — | Falla si hay `localhost`/`127.0.0.1` fijos en `apps/`, `packages/`, `docker/` o `deploy/compose/` (TC-PLATFORM-STACK-005). |
| `pnpm test:integration` | — | Testcontainers (independiente del stack Compose). |
| `pnpm test:stack` | — | Suite TC-PLATFORM-STACK-* en un proyecto Compose desechable `pfos-test` con puertos propios (lenta; CI la corre en `stack-smoke`). |

Verificado el 2026-10-02 en Windows 11 (PowerShell y Git Bash): `setup:env` (fichero nuevo y `.env` existente sin cambios), `stack:up` (deps healthy en ~31 s), `dev` (api, worker y web `/health/ready` = 200), `stack:up -- --profile core`, `stack:ps`, `stack:logs`, `db:migrate`, `db:seed -- --profile=minimal`, `stack:down`.

### 0.6 Matriz de paridad

| Aspecto | Modo A | Modo B | CI | Staging/Prod |
|---|---|---|---|---|
| Código / imagen | fuente en host | imagen `runtime` local | imagen `sha-<commit>` | misma imagen por digest |
| Config | `.env` | `.env` + overrides de direcciones | variables del workflow | secrets manager + variables |
| PostgreSQL | contenedor `postgres:18` | ídem | Testcontainers / servicio | gestionado |
| Object storage | SeaweedFS | SeaweedFS | SeaweedFS | S3 |
| IdP | Keycloak | Keycloak | Keycloak | según ADR-0013 |
| Cola | pg-boss | pg-boss | pg-boss | pg-boss |


## 1. Objetivos y principios

| Objetivo | Cómo se cumple |
|---|---|
| Un comando para todo el producto | `pnpm stack:up -- --profile core` (por defecto `stack:up` levanta `deps`, modo A) |
| Solo levantar lo necesario | Compose **profiles** `deps`, `core`, `seed`, `observability`, `valkey`, `ml` (+ `tools` propuesto, ver §4.6) |
| Cross-platform (owner en **Windows**) | Scripts TypeScript ejecutados con `tsx` vía `pnpm`; **cero scripts solo-bash** (ADR-0012) |
| Paridad con cloud | Las mismas imágenes `finance-web` / `finance-api` que CI promueve a staging/producción ([20-container-strategy.md](20-container-strategy.md)) |
| 12-factor | Configuración 100 % por env vars; `.env.example` sin secretos; hostnames de servicio Compose, nunca `localhost` hardcodeado |
| Arranque determinista | `healthcheck` en cada servicio de larga vida; `depends_on` con `service_healthy` y `service_completed_successfully` (para `migrate`) |
| Datos persistentes y reseteables | Volúmenes nombrados + `pnpm stack:reset` (volúmenes limpios → arranque → migraciones → seed) |

## 2. Prerrequisitos

### 2.1 Windows 11 (entorno principal del owner) — as-built (2026-10-02)

| Herramienta | Versión | Notas |
|---|---|---|
| **WSL2** | kernel actual (`wsl --update`) | Requerido por Docker Desktop (backend WSL2). El repo puede vivir en `D:\` (modo A); WSL2 solo hace falta para el modo C / Dev Containers (§11.2). |
| **Docker Desktop** | Compose v2 ≥ 2.24 (verificado con Compose v5.5.1) | Necesario para `depends_on.required`/`restart`, `healthcheck.start_interval`, `configs.content` y `up --wait`. Docker 29 rechaza `start_interval` sin `start_period` (SPIKE-08). |
| **Node.js** | `engines`: `>=22.12 <27`; `.nvmrc` = **24** (misma línea que las imágenes `node:24.21.0-bookworm-slim` y que CI) | Verificado también con Node 22.23 en el host. Instalar con `fnm`, `nvm-windows` o `volta`. |
| **pnpm** | `packageManager: pnpm@12.4.2` vía **corepack** (`corepack enable`) | Nunca `npm i -g pnpm`. Si corepack no viene con la línea de Node instalada: `npm i -g corepack`. |
| **Git** | 2.4x | Line endings gobernados por [`.gitattributes`](../.gitattributes) (`eol=lf`, §11.1). |

> No se requiere instalar PostgreSQL, Valkey, Keycloak ni Python en el host: todo corre en contenedores.

### 2.2 macOS / Linux

Docker Desktop, OrbStack o Docker Engine + plugin Compose v2; Node (ver `engines`); corepack. Mismos comandos (CI los ejecuta en `ubuntu-latest`).

### 2.3 Verificación

No existe `pnpm doctor` (propuesto en Phase 0, no implementado). La verificación práctica es:

```powershell
# PowerShell o Git Bash — mismo comando
pnpm setup:env -- --check   # puertos PF_* libres (exit 3 si hay conflicto)
pnpm stack:up               # falla con mensaje claro si Docker no responde o algo no llega a healthy
```

## 3. Flujo de arranque: clone → install → stack:up — as-built (2026-10-02)

```mermaid
flowchart LR
  A[git clone] --> B[corepack enable]
  B --> C[pnpm install]
  C --> D[pnpm setup:env<br/>.env desde .env.example<br/>+ secretos dev aleatorios]
  D --> E{modo}
  E -->|A| F[pnpm stack:up<br/>perfil deps] --> G[pnpm dev<br/>migrate + api/worker/web en el host]
  E -->|B| H[pnpm stack:up -- --profile core]
  G --> I[pnpm stack:down]
  H --> I
```

```powershell
git clone https://github.com/manuXD270516/personal-finances.git
cd personal-finances
corepack enable
pnpm install
pnpm setup:env                      # crea .env (no versionado); en un .env existente conserva los valores
# Modo A — apps en el host
pnpm stack:up                       # perfil deps: postgres, object-storage, mailpit, keycloak
pnpm dev                            # Ctrl+C para salir
# Modo B — todo en contenedores
pnpm stack:up -- --profile core
pnpm db:seed -- --profile=minimal   # opcional
pnpm stack:logs -- finance-api
pnpm stack:down
```

Secuencia interna de `stack:up -- --profile core` (`docker compose -p pfos --profile core up -d --wait`):

```mermaid
sequenceDiagram
  participant S as pnpm stack:up
  participant C as docker compose
  participant PG as postgres
  participant OS as object-storage
  participant MP as mailpit
  participant KC as keycloak
  participant M as migrate (one-shot)
  participant API as finance-api
  participant W as finance-worker
  participant WEB as finance-web
  S->>C: compose --profile core up -d --wait
  C->>PG: start (pg_isready por TCP; init: roles pf_migrator/keycloak + BD keycloak)
  C->>OS: start (SeaweedFS mini, /healthz)
  C->>MP: start (mailpit readyz)
  PG-->>C: healthy
  C->>KC: start (depends_on postgres healthy, --import-realm)
  C->>M: run migrate (depends_on postgres + object-storage healthy)
  M-->>C: exit 0 (service_completed_successfully)
  C->>API: start (migrate completed + postgres/object-storage/mailpit healthy)
  C->>W: start (idem)
  API-->>C: healthy (/health/ready)
  C->>WEB: start (depends_on finance-api + keycloak healthy)
  WEB-->>C: healthy (/api/health/ready)
  C-->>S: --wait devuelve 0 → imprime URLs
```

Si `migrate` falla, `finance-api` y `finance-worker` **no arrancan** y `stack:up` termina con código ≠ 0 mostrando el log de `migrate` (scenario *Migrations gate the API*).

## 4. Profiles de Compose — as-built (2026-10-02)

| Profile | Servicios | Cuándo usarlo |
|---|---|---|
| `deps` | `postgres`, `object-storage`, `mailpit`, `keycloak` | **Modo A** (por defecto de `pnpm stack:up`): apps en el host con `pnpm dev`. |
| `core` | `deps` + `migrate`, `finance-api`, `finance-worker`, `finance-web` | **Modo B**: producto completo en contenedores (demo, verificación pre-PR, `test:stack`). |
| `seed` | `seed` (one-shot) | Solo vía `pnpm db:seed` / `stack:reset` (`compose run --rm`). |
| `observability` | `otel-lgtm` | Trazas/métricas/logs locales (Grafana en `PF_GRAFANA_PORT`, 23001). Combinable con `deps` o `core`; requiere `OTEL_ENABLED=true`. |
| `valkey` | `valkey` | Solo si `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey` (ADR-0008); ya no forma parte de `deps`/`core`. |
| `ml` | — (reservado) | `ml-forecasting` en Phase 8. |
| `tools` *(propuesta, no implementada)* | p. ej. `db-admin` | Ver §4.6. |

> Los servicios de `deps` declaran `profiles: [deps, core]`, de modo que `--profile core` incluye las dependencias.

### 4.1 Modo A — `deps` + apps en el host (recomendado para codificar)

```mermaid
flowchart LR
  subgraph Host[Host Windows]
    WEBH[finance-web<br/>next dev :23000]
    APIH[finance-api<br/>tsx watch :28080]
    WH[finance-worker<br/>tsx watch, health :28082]
  end
  subgraph Docker[Docker - profile deps]
    PG[(postgres :25432)]
    OS[(object-storage :29000)]
    KC[keycloak :28081]
    MP[mailpit :28025/21025]
  end
  WEBH --> APIH
  WEBH --> KC
  APIH --> PG & OS & KC & MP
  WH --> PG & OS & MP
```

```powershell
pnpm stack:up     # perfil deps
pnpm dev          # migrate (host) + api/worker/web con recarga; Ctrl+C para salir
```

Las apps leen el **mismo `.env`** que Compose: sus valores ya son los del modo A (`127.0.0.1:${PF_*_PORT}`), así que no existe `.env.host` (propuesto en Phase 0, descartado por el contrato de §0.3). `pnpm dev` ejecuta las fuentes TypeScript (condición de export `@pf/source`), sin build previo.

### 4.2 Modo B — `core` (todo en contenedores)

```powershell
pnpm stack:up -- --profile core
pnpm stack:up -- --profile core --profile observability
```

Las apps se comunican por nombres de servicio (`postgres`, `object-storage`, `finance-api`…): `compose.yaml` sobrescribe solo las direcciones (`x-app-addresses`). Se usan las imágenes locales `pfos/finance-*:local` (`pnpm images:build` o `--build`) o imágenes publicadas por digest con `FINANCE_API_IMAGE` / `FINANCE_WEB_IMAGE` en `.env` (`stack:up` sin `--build` no reconstruye una imagen presente). En CI, `PF_STACK_PREBUILT_IMAGES=1` hace que `pnpm test:stack` use las imágenes ya cargadas sin construir.

### 4.3 Modo C — `core` + Compose Watch (opcional, no implementado)

Para depurar comportamiento solo-contenedor con recarga, un override `compose.watch.yaml` usaría `develop.watch`. SPIKE-08 confirmó que en Windows solo es fiable con el repo dentro de WSL2 (§11.2); no existe en el repo y no es el camino principal.

### 4.4 `seed`

`pnpm db:seed -- --profile=minimal` ejecuta `docker compose --profile core run --rm seed seed --profile=minimal` (o en el host con `--host`). Hoy solo existe el dataset `minimal` (registra la ejecución en `platform.seed_run`); `demo` y `large` se rechazan con "todavía no existe" hasta que lleguen los datasets de [29-seed-datasets.md](29-seed-datasets.md). Ver §8.

### 4.5 `observability` y `ml`

`otel-lgtm` recibe OTLP en `4317`/`4318` (publicados en `PF_OTLP_GRPC_PORT`/`PF_OTLP_HTTP_PORT`). Las apps exportan solo con `OTEL_ENABLED=true`; si no, el SDK queda en no-op. `ml-forecasting` es Phase 8 y **nunca** es dependencia de `finance-api` (ARCHITECTURE §2).

### 4.6 `tools` (propuesta)

Un profile `tools` con un cliente web de PostgreSQL facilitaría inspección sin instalar nada. No figura en ARCHITECTURE §10; se propone como opcional y **no** se incluye en el compose canónico hasta aprobarse (Preguntas abiertas).

## 5. `compose.yaml` — as-built (2026-10-02)

Fichero real: [`deploy/compose/compose.yaml`](../deploy/compose/compose.yaml) (proyecto Compose fijo `pfos`). El bloque ilustrativo de Phase 0 se eliminó de este documento; resumen de lo implementado:

| Servicio | Imagen (tag + digest en el fichero) | Perfiles | Host (`PF_BIND_ADDR`, 127.0.0.1) → contenedor | Healthcheck |
|---|---|---|---|---|
| `postgres` | `postgres:18.6-trixie` | deps, core | `PF_POSTGRES_PORT` 25432 → 5432 | `pg_isready -h 127.0.0.1` |
| `object-storage` | `chrislusf/seaweedfs:4.48` (`weed mini`, solo S3) | deps, core | `PF_OBJECT_STORAGE_PORT` 29000 → 8333 | `wget /healthz` |
| `mailpit` | `axllent/mailpit:v1.27.7` | deps, core | `PF_MAILPIT_UI_PORT` 28025 → 8025, `PF_MAILPIT_SMTP_PORT` 21025 → 1025 | `mailpit readyz` |
| `keycloak` | `quay.io/keycloak/keycloak:26.8.0` (`start-dev --import-realm`) | deps, core | `PF_KEYCLOAK_PORT` 28081 → 8080 | `/health/ready` en management 9000 vía `/dev/tcp` |
| `valkey` | `valkey/valkey:9.1.2-alpine` | valkey | `PF_VALKEY_PORT` 26379 → 6379 | `valkey-cli ping` |
| `migrate` | `${FINANCE_API_IMAGE:-pfos/finance-api:local}` (`migrate`) | core | — | desactivado (one-shot) |
| `finance-api` | idem (`api`) | core | `PF_API_PORT` 28080 → 8080 | `healthcheck.mjs …:8080/health/ready` |
| `finance-worker` | idem (`worker`) | core | — (8082 solo red interna) | `healthcheck.mjs …:8082/health/ready` |
| `finance-web` | `${FINANCE_WEB_IMAGE:-pfos/finance-web:local}` | core | `PF_WEB_PORT` 23000 → 3000 | `healthcheck.mjs …:3000/api/health/ready` |
| `seed` | finance-api (`seed --profile=…`) | seed | — | desactivado (one-shot) |
| `otel-lgtm` | `grafana/otel-lgtm:0.34.0` | observability | `PF_GRAFANA_PORT` 23001 → 3000, `PF_OTLP_GRPC_PORT` 24317, `PF_OTLP_HTTP_PORT` 24318 | fichero `/tmp/ready` |

### 5.0 Emails de notificación en local y CI (`add-alerts`)

El worker envía los emails de las notificaciones por SMTP a Mailpit (`EMAIL_DRIVER=smtp`, `SMTP_HOST`/`SMTP_PORT` del `.env`: `PF_MAILPIT_SMTP_PORT` desde el host; en modo B Compose apunta a `mailpit:1025`). Los correos no salen a internet: se ven en la UI de Mailpit (`PF_MAILPIT_UI_PORT`) o por su API (`GET /api/v1/messages`, `GET /api/v1/message/{id}`), que es lo que consultan las pruebas de integración (Testcontainers `axllent/mailpit`, misma imagen fijada que Compose) y el E2E. En producción `EMAIL_DRIVER=none` (solo in-app) hasta que el change de despliegue elija proveedor (docs/33 D87). Variables: [config-reference.md](config-reference.md) (grupo "Notificaciones"); diagnóstico de entregas fallidas: [runbooks/notification-email.md](runbooks/notification-email.md).

### 5.1 Notas de diseño del compose (vigentes)

- **Una sola fuente de configuración:** los servicios de app cargan el `.env` en uso (`env_file: ${PF_APP_ENV_FILE:-../../.env}`; los scripts fijan la ruta absoluta) y el ancla `x-app-addresses` sobrescribe solo `DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT` y `VALKEY_URL` con nombres de servicio y puertos canónicos (§0.3 punto 5).
- **Roles de base de datos:** `migrate` usa `DATABASE_MIGRATOR_URL` con el rol `pf_migrator` (propietario, `CREATEROLE`, sin `BYPASSRLS`); api, worker y seed usan `pf_app`. La migración de bootstrap crea `pf_app` y `migrate` le fija la contraseña (ARCHITECTURE §9).
- **Init sin ficheros sueltos:** el SQL de init de PostgreSQL (roles `pf_migrator` y `keycloak`, base `keycloak`) y la identidad S3 de SeaweedFS se definen como `configs.content` en el propio `compose.yaml`, interpolados desde `.env` — no hay secretos en el repo. `keycloak-db` no es un volumen: es la base `keycloak` dentro de `postgres` (persistida en `pg-data`).
- **`127.0.0.1` solo en healthchecks:** se ejecutan dentro del propio contenedor; `pnpm check:hosts` excluye esos bloques (TC-PLATFORM-STACK-005).
- **Hardening de apps:** `init: true` (tini como PID 1), `read_only: true` + `tmpfs` (`/tmp`; en web también `.next/cache`), `cap_drop: [ALL]`, `no-new-privileges`, logging `local` (10 MB × 3) y `deploy.resources.limits` (Compose v2 los aplica sin Swarm).
- **Arranque determinista:** `migrate` con `service_completed_successfully`; `postgres` con `restart: true` (reinicia las apps si Compose reinicia la BD); `valkey` con `required: false`; web espera a `finance-api` y `keycloak` healthy.
- **Shutdown:** `stop_grace_period` 30 s (api, web) y 45 s (worker) por encima de `SHUTDOWN_TIMEOUT_MS=25000`.
- **Keycloak issuer:** `KC_HOSTNAME=${OIDC_PUBLIC_BASE_URL}` (URL que ve el navegador, `http://localhost:28081`) + `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` para el back-channel dentro de la red.
- **Buckets:** `migrate` crea el bucket y su CORS solo con `OBJECT_STORAGE_ENSURE_BUCKET=true` (local/CI). En cloud los crea Terraform ([22-infrastructure.md](22-infrastructure.md)).
- **Red y volúmenes:** red por defecto `pfos_default`; volúmenes `pfos_pg-data`, `pfos_object-storage-data`, `pfos_valkey-data`, `pfos_otel-lgtm-data`.

### 5.2 Estado de MinIO y alternativas (verificado 2026-10-01)

| Opción | Estado (aprox., fuentes públicas) | Encaje local |
|---|---|---|
| MinIO community | Dejó de publicar binarios/imágenes oficiales en oct-2025; "maintenance mode" (dic-2025) y repo archivado/no mantenido (feb-2026). Reportes indican que el namespace `minio/*` de Docker Hub dejó de servir imágenes en sep-2026; quedan tags históricos en `quay.io/minio/minio`. Consola community recortada desde 2025. | **Descartado** como default: sin parches de seguridad. |
| **SeaweedFS** (Apache-2.0) | Activo; `weed mini` arranca todo en un proceso para dev. | Candidato principal (imagen única, S3 + presigned URLs). |
| **Garage** (AGPL-3.0, servidor no se distribuye con el producto) | Activo (v2.x en 2026); requiere bootstrap de layout/keys (un one-shot extra). | Alternativa sólida; ligera. |
| RustFS (Apache-2.0) | 1.0 GA (sep-2026), proyecto joven. | Vigilar. |

SPIKE-07 valida: presigned PUT/GET con el SDK v3 de AWS, `forcePathStyle`, checksums (`x-amz-checksum-*` por defecto en SDK v3 recientes), CORS para subida directa desde el navegador, versionado (para paridad con S3) y comportamiento de multipart.

## 6. Variables de entorno — as-built (2026-10-02)

### 6.1 Convenciones

- `UPPER_SNAKE_CASE`. Dos familias (§0.3): `PF_*` = plataforma local, solo la leen `compose.yaml` y `scripts/stack` (puertos `PF_<SVC>_PORT`, `PF_BIND_ADDR`, secretos de desarrollo `PF_DEV_*`, `PF_COMPOSE_PROFILES`); runtime de la app sin prefijo propio y por dominio (`DATABASE_*`, `OBJECT_STORAGE_*`, `JOB_QUEUE_*`, `SESSION_STORE`, `VALKEY_URL`, `API_*`, `WORKER_*`, `OIDC_*`, `WEB_*`, `APP_*`, `PFOS_ENV`, `LOG_LEVEL`) y `OTEL_*` estándar de OpenTelemetry.
- `NEXT_PUBLIC_*` **jamás** contiene secretos ni URLs de entorno (se embebería en el bundle); la web lee y valida su configuración en runtime (`instrumentation.ts`) para cumplir *build once* ([20-container-strategy.md](20-container-strategy.md) §7).
- Validación al arrancar con zod en `@pf/platform/config`: cada proceso valida solo las variables que usa; si alguna falta o es inválida termina con código 78 (`EX_CONFIG`) listándolas todas, sin imprimir valores. Ningún módulo fuera de `@pf/platform` lee `process.env` (regla ESLint `no-restricted-properties`).
- Secretos: sufijo `_PASSWORD`, `_SECRET`, `_KEY`, `_TOKEN`; el logger los redacta.
- Ficheros: `.env.example` (versionado, sin secretos) y `.env` (generado por `pnpm setup:env`, ignorado por git, leído por Compose **y** por los procesos del host). `PF_ENV_FILE` permite usar otro fichero (lo usa `test:stack`). No existen `.env.host` ni `.env.test`.
- `PFOS_ENV` ∈ `local | ci | staging | production`. Comportamientos dev-only (`seed`, `stack:reset`, creación de buckets) se rechazan fuera de `local | ci`.
- Providers de tasas de mercado (`add-market-rate-providers`, as-built 2026-10-03; defaults confirmados en [31-phase-1-consolidation-decisions.md](31-phase-1-consolidation-decisions.md) D31, D32 y D38; detalle en [config-reference.md](config-reference.md)): `FX_PROVIDER_PRIMARY` (`paralelo_bo`), `FX_PROVIDER_FALLBACK` (`dolarapi_bo`), `FX_PROVIDER_OFFICIAL` (`dolarapi_bo`) — `none` deshabilita el rol —, `FX_POLL_INTERVAL` (`15m`, mínimo `1m`), `FX_STALE_AFTER_PARALLEL` (`60m`, principal), `FX_STALE_AFTER_OFFICIAL` (`48h`), `FX_STALE_AFTER_FALLBACK` (`180m`, umbral propio del respaldo: bo.dolarapi.com publica con ~2 h de retraso), `FX_MANUAL_FALLBACK_MAX_AGE` (`24h`, antigüedad máxima de una manual de otro tipo como último recurso de la valoración; su desvío respecto de la última tasa de provider no puede superar `FX_ANOMALY_THRESHOLD_PCT`), `FX_ANOMALY_THRESHOLD_PCT` (`5`), `FX_PROVIDER_TIMEOUT` (`10s`, máx. `30s`) y `FX_BACKFILL_ENABLED` (`true`). Sintaxis laxa en el esquema: la semántica la valida FX y un valor inválido NO impide arrancar (los providers no se inician y `GET /fx-providers/status` informa `FX_PROVIDER_CONFIG_INVALID`). `.env.example` trae los defaults (el worker local consulta paralelo.bo y bo.dolarapi.com con solicitudes anónimas); los tests (`baseEnv` de Testcontainers, `test:stack`, E2E) fuerzan `none`: sin red. Runbook: [runbooks/fx-provider-caido.md](runbooks/fx-provider-caido.md).
- Ventana de vigencia de tasas (docs/31 D53; detalle en [config-reference.md](config-reference.md)): `REPORTING_RATE_VALIDITY_WINDOW` (`7d`, rango `1d`–`90d`) es un ajuste de **Reporting**: la API lo entrega a FX, que con él resuelve la valoración del Home, el equivalente de cuentas y la tasa de referencia de las conversiones; el resumen lo informa en `meta.rateWindowDays`. Un valor inválido impide arrancar la API (código 78).
- Providers en el stack en contenedores (modo B, decisión del owner 2026-10-03, docs/31 D33): ambos providers quedan habilitados por defecto en todo entorno y el contenedor `finance-worker` los consulta por la red Compose por defecto del proyecto (bridge **no** interno: no declarar `internal: true`), con salida HTTPS (TCP 443) a `paralelo.bo` y `bo.dolarapi.com`. Las `FX_*` llegan solo del `.env` vía `env_file` (contrato único; `compose.yaml` no fija ninguna). El cliente usa `node:https` con el almacén de CA de Node (no requiere `ca-certificates` en la imagen) y no usa proxy: detrás de un firewall o proxy corporativo hay que permitir ese egress al host de Docker. Verificación manual (una solicitud anónima, sin datos del usuario): `docker compose -p pfos exec finance-worker node -e "fetch('https://paralelo.bo/api/v1/rate').then(r=>console.log(r.status))"` debe imprimir `200`; luego `GET /workspaces/{id}/fx-providers/status` muestra `HEALTHY` tras el primer ciclo. `pnpm test:stack` verifica sin red que el worker solo está en redes no internas y que sus `FX_*` son las del `.env` (TC-FX-PROVIDER-019), con los providers en `none`.
- Convenciones de API (`add-api-conventions`, as-built 2026-10-02; detalle en [config-reference.md](config-reference.md)): `CURSOR_SIGNING_KEY` (secreto `kid:secreto[,kid:secreto…]` de los cursores de paginación; **obligatorio en staging/production**, en `local | ci` se genera uno efímero si falta), `IDEMPOTENCY_RETENTION` (`24h` por defecto, rango `24h`–`7d`), `RATE_LIMIT_STORE=memory|valkey` (toggle; `valkey` aún sin adapter y falla al arrancar), `RATE_LIMIT_READS_PER_MIN=600`, `RATE_LIMIT_WRITES_PER_MIN=120`, `RATE_LIMIT_COSTLY_PER_MIN=10` (operaciones costosas, `fix-phase-2-gaps`) y `API_PROBLEM_TYPE_BASE` (base del `type` RFC 9457).

### 6.2 `.env.example`

Fichero real: [`.env.example`](../.env.example). Bloques: plataforma local (`PF_BIND_ADDR=127.0.0.1` y puertos `PF_*_PORT` con defaults "2 + puerto canónico"), secretos de desarrollo `PF_DEV_*=__generate__` (superusuario y roles de PostgreSQL, Keycloak, cliente OIDC, usuarios `owner|editor|viewer|outsider@demo.pfos.test`, roles `pf_bff` y `pf_worker`, secreto de sesiones del BFF, credenciales S3), runtime de la app (valores del modo A interpolados desde los `PF_*`, p. ej. `DATABASE_URL=postgres://pf_app:${PF_DEV_DB_APP_PASSWORD}@${PF_BIND_ADDR}:${PF_POSTGRES_PORT}/pfos?sslmode=disable`; el worker usa `WORKER_DATABASE_URL` con el rol `pf_worker`, cuya contraseña `PF_DEV_DB_WORKER_PASSWORD` fija `migrate`), identidad (`OIDC_PUBLIC_BASE_URL`, `WEB_PUBLIC_URL`, `OIDC_ISSUER_URL`), BFF (`FINANCE_API_URL`, `OIDC_CLIENT_*`, `OIDC_SCOPES`, `BFF_DATABASE_URL`, `BFF_SESSION_ENC_KEY`, `SESSION_IDLE_TIMEOUT`, `SESSION_ABSOLUTE_TIMEOUT`), OpenTelemetry (`OTEL_ENABLED=false`) e imágenes (`FINANCE_API_IMAGE`/`FINANCE_WEB_IMAGE` vacías = build local). La referencia completa de variables de runtime, generada desde el esquema, es [config-reference.md](config-reference.md) (`pnpm config:docs`; CI falla si está desactualizada).

> El dominio `pfos.test` es un TLD reservado (RFC 2606), sin riesgo de envío real.

### 6.3 Sin `.env.host`

El diseño de Phase 0 proponía derivar un `.env.host` para el modo A. Se descartó: el `.env` único ya contiene los valores del modo A y el modo B sobrescribe solo direcciones en `compose.yaml` (§0.3, §5.1).

## 7. Catálogo de scripts (`pnpm`, TypeScript cross-platform) — as-built (2026-10-02)

Implementación en [`scripts/stack/src/`](../scripts/stack/src/), ejecutada con `tsx`; utilidades en `scripts/stack/src/lib/` (`compose.ts` construye `docker compose -p pfos -f deploy/compose/compose.yaml --env-file <.env> [--profile …]` con `spawn` y `shell: false`; `paths.ts` usa `node:path`; `cli.ts` pide confirmación en operaciones destructivas y, sin terminal interactiva, exige `--yes`; `ports.ts` consulta `netsh … excludedportrange` en Windows). Nada de `rm -rf`, `&&` dependiente de shell ni `$VAR` en `package.json`. Los scripts del `package.json` raíz son la fuente de verdad; la tabla de comandos está en §0.5.

Otros comandos del repo (fuera del stack):

| Comando | Qué hace |
|---|---|
| `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` | Turborepo sobre todos los paquetes (`pnpm turbo run typecheck lint test` los combina). |
| `pnpm format` / `pnpm format:check` | Prettier (excluye `docs/`, `openspec/`, `README.md`… — ver `.prettierignore`). |
| `pnpm spec:validate` | `openspec validate --all --strict --no-interactive` con telemetría desactivada. |
| `pnpm arch:check` | dependency-cruiser con [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs) sobre `apps`, `packages` y `scripts`. |
| `pnpm traceability:check` / `pnpm traceability:matrix` | Reglas de [17-test-traceability.md](17-test-traceability.md) y matriz en `tests/traceability/`. |
| `pnpm config:docs` / `pnpm config:docs:check` | Genera / verifica [config-reference.md](config-reference.md). |
| `pnpm test:integration` | Integración con Testcontainers (PostgreSQL real): API, repositorios, RLS y BFF (`iam.bff_session`). |
| `pnpm test:e2e` | Playwright (Chromium) contra el stack desechable `pfos-e2e` con Keycloak real (§10.2). |

Propuestos en Phase 0 y **no implementados** (pendientes, sin fecha): `pnpm doctor`, `db:migrate:new`, `db:psql`, `stack:nuke`, `keycloak:export`, `dev:users`. `env:init` pasó a llamarse `setup:env` y `test:platform` es `test:stack`.

## 8. Reset y seeds

### 8.1 `pnpm stack:reset` — as-built (2026-10-02)

```mermaid
flowchart TD
  A[pnpm stack:reset -- --seed=minimal] --> G{PFOS_ENV local o ci}
  G -->|no| X0[error]
  G -->|sí| B{confirmación<br/>o --yes}
  B -->|no| X[cancelado]
  B -->|sí| C[compose down --volumes<br/>borra pg-data, object-storage-data…]
  C --> D[compose up -d --wait<br/>perfiles pedidos, deps por defecto]
  D --> E[init PG: roles + BD keycloak<br/>keycloak importa el realm]
  E --> F{¿perfil core?}
  F -->|no| M[compose run --rm migrate]
  F -->|sí, ya corrió como dependencia| S
  M --> S[compose --profile core run --rm seed seed --profile=…<br/>se omite con --seed=none]
```

- Opciones: `--seed=minimal|none`, `--profile core`, `--yes`. Las opciones `--keep-objects` / `--only-db` propuestas en Phase 0 no se implementaron.
- El reset nunca se ejecuta si `PFOS_ENV ∉ {local, ci}` (guard en el script **y** en el comando `seed` del contenedor).

### 8.2 Perfiles de seed

Definición detallada de datasets en [29-seed-datasets.md](29-seed-datasets.md); aquí solo la mecánica:

| Perfil | Contenido (resumen) | Uso | Tiempo objetivo |
|---|---|---|---|
| `minimal` | 1 workspace (BOB base), owner/editor/viewer, cuentas mínimas (banco BOB, efectivo, wallet USDT, tarjeta), categorías de sistema, unas pocas transacciones incl. una conversión USDT→BOB | E2E, demo rápida, desarrollo diario | < 10 s |
| `demo` | 12–24 meses realistas: presupuestos, recurrentes, deudas, metas | Demos, revisión UX, base de *migration test* (release snapshot) | < 60 s |
| `large` | Volumen para rendimiento (p. ej. ≥ 100k transacciones, varios workspaces) | k6 / pruebas de rendimiento | < 10 min |

Reglas: seeds **deterministas** (PRNG sembrado, `Clock` fijo — regla `pf/no-nondeterminism`), escritos **a través de los casos de uso** de la capa `application` (respetan invariantes del ledger y Audit) y no por SQL crudo; idempotentes por `seed_run` (re-ejecutar no duplica). El seed resuelve el `sub` de cada usuario Keycloak dev para crear `iam.user` + membership.

> **As-built (2026-10-02):** solo existe `minimal` (`dataset_version` 2): registra su ejecución en `platform.seed_run` y siembra las identidades de IDENTITY (`add-workspace-identity`, tarea 8.5): los usuarios `owner`, `editor`, `viewer` y `outsider` (`<usuario>@demo.pfos.test`, con el `sub` fijo que tienen en el realm de desarrollo y el emisor `OIDC_ISSUER_URL`), `W1 Personal Demo` (owner OWNER, editor EDITOR, viewer VIEWER) y `W2 Other Demo` (owner y outsider OWNER). Es idempotente y corre con el rol de la app bajo RLS. Sin `OIDC_ISSUER_URL` omite las identidades con un aviso. Cuentas, categorías y transacciones llegan con sus contextos. `demo` y `large` se rechazan con un error explícito hasta que lleguen los datasets de [29-seed-datasets.md](29-seed-datasets.md).

## 9. Backup / restore local (resumen) — as-built (2026-10-02)

`pnpm backup:local [-- --name=<etiqueta>]` → `backups/<UTC>-<etiqueta>/` (en la raíz del repo, ignorado por git) con `pfos.dump` y `keycloak.dump` (`pg_dump -Fc`), `objects/` (mirror del bucket vía S3) y `manifest.json` (sha256). `pnpm restore:local -- <backup-id|latest> [--yes] [--with-keycloak]` detiene api/worker/web, restaura base de datos y objetos y los vuelve a levantar. Detalle y garantías en [30-backup-and-disaster-recovery.md](30-backup-and-disaster-recovery.md) §3.

## 10. Keycloak: realm de desarrollo — as-built (2026-10-02)

- Fichero: [`deploy/compose/keycloak/realm-pfos-dev.json`](../deploy/compose/keycloak/realm-pfos-dev.json) (versionado, **sin secretos**). Usa placeholders `${PF_DEV_OIDC_CLIENT_SECRET}`, `${PF_DEV_KC_OWNER_PASSWORD}`, `${PF_DEV_KC_EDITOR_PASSWORD}`, `${PF_DEV_KC_VIEWER_PASSWORD}`, `${PF_DEV_KC_OUTSIDER_PASSWORD}` y `${PF_WEB_PUBLIC_URL}`, que Keycloak sustituye al importar (`--import-realm`) con las variables que le pasa `compose.yaml` — confirmado, no hace falta render previo.
- Contenido (as-built `add-workspace-identity`): realm `pfos` con access token de 5 min, refresh rotativo (`revokeRefreshToken`, `refreshTokenMaxReuse=0`); client scopes explícitos `basic`, `profile`, `email` y `pfos.api` (este último agrega el scope `pfos.api` y la audiencia `finance-api` al access token); client confidencial `pfos-web` (BFF, Authorization Code + PKCE S256) con redirect `${PF_WEB_PUBLIC_URL}/api/bff/auth/callback` y post-logout redirect `${PF_WEB_PUBLIC_URL}/`; usuarios de la Minimal Seed `owner`, `editor`, `viewer` y `outsider` (`<usuario>@demo.pfos.test`, email verificado, id fijo). **Los roles de workspace (`OWNER/EDITOR/VIEWER`) NO viven en Keycloak**: los asigna la aplicación en `iam.workspace_membership` (ARCHITECTURE §5, ADR-0010); la Minimal Seed los siembra. Keycloak solo autentica.
- **Cambios del realm:** Keycloak solo importa el realm si no existe. Tras actualizar `realm-pfos-dev.json` (o al pasar a esta versión desde una anterior) hay que recrear la base de Keycloak: `pnpm stack:reset -- --seed=minimal` (borra los volúmenes locales del proyecto `pfos`).
- Credenciales: generadas por `pnpm setup:env` en `.env` (`PF_DEV_KC_*`, dev-only). Consola admin en `${OIDC_PUBLIC_BASE_URL}/admin` (`http://localhost:28081/admin`) con el usuario `pfos-admin` y `PF_DEV_KEYCLOAK_ADMIN_PASSWORD`.
- Pendiente (no implementado): `pnpm keycloak:export` para exportar cambios al realm y `pnpm dev:users`.

### 10.1 Login local y usuarios de prueba — as-built (2026-10-02)

1. `pnpm setup:env` (genera en `.env` las contraseñas `PF_DEV_KC_OWNER_PASSWORD`, `PF_DEV_KC_EDITOR_PASSWORD`, `PF_DEV_KC_VIEWER_PASSWORD`, `PF_DEV_KC_OUTSIDER_PASSWORD`, el secreto del client `PF_DEV_OIDC_CLIENT_SECRET`, la contraseña del rol `pf_bff` `PF_DEV_DB_BFF_PASSWORD` y el secreto de cifrado de sesiones `PF_DEV_BFF_SESSION_SECRET`; un `.env` existente conserva sus valores y solo recibe los nuevos).
2. Modo B: `pnpm stack:up -- --profile core` y `pnpm db:seed -- --profile=minimal`. Modo A: `pnpm stack:up`, `pnpm db:migrate`, `pnpm db:seed -- --profile=minimal` y `pnpm dev`.
3. Abrir `WEB_PUBLIC_URL` (`http://localhost:23000`): sin sesión, el BFF redirige al login de Keycloak. Usuario `owner` (o `editor`, `viewer`, `outsider`) con la contraseña `<PF_DEV_KC_OWNER_PASSWORD del .env>`; las contraseñas nunca se escriben en el repo ni en la documentación.

| Usuario | Email | Membresías (Minimal Seed) | Para probar |
|---|---|---|---|
| `owner` | owner@demo.pfos.test | OWNER de W1 y W2 | Configuración del workspace, selector W1/W2 |
| `editor` | editor@demo.pfos.test | EDITOR de W1 | 403 `INSUFFICIENT_ROLE` al cambiar la configuración |
| `viewer` | viewer@demo.pfos.test | VIEWER de W1 | Solo lectura |
| `outsider` | outsider@demo.pfos.test | OWNER de W2 | 403 `WORKSPACE_ACCESS_DENIED` sobre W1 |

Un usuario creado a mano en la consola de Keycloak (email verificado) obtiene en su primer login un workspace personal (moneda base `APP_REPORTING_CURRENCY`, zona `APP_TIMEZONE`, locale `APP_DEFAULT_LOCALE`). El navegador solo recibe la cookie opaca `__Host-pfos_sid` (HttpOnly; Chromium/Firefox la aceptan con `Secure` en `http://localhost`); los tokens viven cifrados en `iam.bff_session`.

### 10.2 E2E (Playwright) — as-built (2026-10-02)

`pnpm test:e2e` (paquete `tests/e2e`, `@pf/e2e`) levanta un stack **desechable** `pfos-e2e` en modo B con un `.env` temporal (secretos propios, puertos `4xxxx`), reconstruye las imágenes (`pnpm images:build`), aplica la Minimal Seed, ejecuta los specs en Chromium contra Keycloak real y baja el stack con sus volúmenes. Nunca toca el proyecto `pfos` de desarrollo. Requiere el navegador de Playwright una vez: `pnpm --filter @pf/e2e run browsers`. Variables: `PF_E2E_KEEP_STACK=1` deja el stack arriba (imprime la ruta del `.env`); `PF_E2E_ENV_FILE=<ruta>` reutiliza ese stack sin levantar ni bajar nada; `PF_STACK_PREBUILT_IMAGES=1` no reconstruye (CI usa las imágenes del job `image`). Bajar a mano: `PF_COMPOSE_PROJECT=pfos-e2e PF_ENV_FILE=<ruta> pnpm stack:down -- --volumes --yes`.

## 11. Troubleshooting en Windows

### 11.1 Line endings

As-built (2026-10-02): [`.gitattributes`](../.gitattributes) fija `* text=auto eol=lf` (con `eol=lf` explícito para `*.sh`, `*.sql` y Dockerfiles, `eol=crlf` para `*.ps1` y binarios marcados) — imprescindible porque `core.autocrlf=true` rompe los entrypoints (SPIKE-08).

Síntoma típico sin esto: `exec /usr/local/bin/docker-entrypoint.sh: no such file or directory` o `$'\r': command not found` en scripts copiados a imágenes. Prettier con `endOfLine: "lf"`; `.editorconfig` `end_of_line = lf`.

### 11.2 File watching y rendimiento (WSL2)

- **Recomendado:** clonar el repo dentro de WSL2 (`\\wsl$\Ubuntu\home\<user>\src\personal-finances`) y abrir con VS Code *Remote - WSL*. Los bind mounts y el watcher (inotify) funcionan nativamente y `pnpm install` es varias veces más rápido que en `/mnt/c` o `D:\`.
- Si el repo vive en `D:\projects\…` (situación actual del owner): Modo A (apps en el host Windows) funciona bien porque no hay bind mounts de código; evitar Modo C. Si el watcher falla en contenedores, `CHOKIDAR_USEPOLLING=1` / `WATCHPACK_POLLING=true` como último recurso (coste CPU).
- Excluir del antivirus (Defender) `node_modules`, `.turbo`, `.next` y la carpeta del repo (acción del owner; afecta a política de seguridad local → decisión suya).
- `.wslconfig`: `memory=8GB`, `processors=4`, `autoMemoryReclaim=gradual`.

### 11.3 Conflictos de puertos — as-built (2026-10-02)

Los puertos de host ya no son los canónicos: defaults "2 + puerto canónico" (25432, 28080, 23000, 28081, 28025/21025, 29000, 26379, 23001, 24317/24318) publicados solo en `PF_BIND_ADDR=127.0.0.1` (SPIKE-08).

| Situación | Solución |
|---|---|
| Un puerto `PF_*_PORT` ocupado por otro proyecto o servicio | `pnpm setup:env -- --check` lo detecta y sugiere una alternativa libre; `pnpm setup:env -- --apply-ports` la escribe en `.env`. Los puertos ya publicados por el propio proyecto `pfos` no cuentan como conflicto. |
| Rangos reservados por Hyper-V/WinNAT | `setup:env` consulta `netsh interface ipv4 show excludedportrange protocol=tcp` y trata esos puertos como ocupados. |
| Cambiar `PF_KEYCLOAK_PORT` o `PF_WEB_PORT` | `OIDC_PUBLIC_BASE_URL`, `WEB_PUBLIC_URL` y `OBJECT_STORAGE_CORS_ORIGINS` se derivan por interpolación en `.env`; no hay que tocarlos a mano. |

### 11.4 Otros

- **Keycloak tarda en estar healthy** (60–90 s en frío): normal; `start_period: 90s`. En caliente `pnpm stack:up` tarda ~30 s.
- **`--wait` agota timeout**: `pnpm stack:ps` y `pnpm stack:logs -- <svc>`.
- **Volumen PG con versión incompatible** tras subir major: `pnpm backup:local` → `stack:reset` → `restore:local`.
- **Reloj desfasado en WSL2** tras suspender (tokens OIDC "not yet valid"): `wsl --shutdown`.
- **VPN corporativa** rompiendo DNS de contenedores: configurar `dns` en Docker Desktop.

## 12. Evaluación de Dev Containers

| Criterio | Dev Container (`.devcontainer/` + compose) | Host + profile `deps` |
|---|---|---|
| Onboarding | Excelente: toolchain idéntico (Node, pnpm, dbmate, psql) | Requiere instalar Node + corepack |
| Rendimiento en Windows | Bueno si el repo está en WSL2/volumen; malo con bind mount desde `D:\` | Bueno |
| IDEs | VS Code / JetBrains Gateway / Codespaces | Cualquiera |
| Docker-in-Docker para Testcontainers | Necesita `docker-outside-of-docker` (socket) — funciona, añade complejidad | Nativo |
| Coste de mantenimiento | Un `devcontainer.json` + Dockerfile de toolchain | Ninguno extra |
| Codespaces / CI parity | Alto | Medio |

**Recomendación:** no obligatorio. Se provee un `.devcontainer/devcontainer.json` **opcional** (Phase 1, prioridad Could) que reutiliza el compose (`dockerComposeFile` + profile `deps`) y la feature `docker-outside-of-docker`. El camino soportado y probado en CI sigue siendo host + `pnpm`.

## 13. Preguntas abiertas

1. ~~**Línea de Node**~~ — resuelto (as-built): Node 24 (`.nvmrc`, imágenes `node:24.21.0-bookworm-slim`, CI); `engines` admite `>=22.12 <27`. Pregunta original: **Línea de Node:** ¿arrancar Phase 1 con Node 26 (LTS desde 2026-10-28, EOL abr-2029) o Node 24 (Maintenance desde 2026-10-20, EOL abr-2028)? Propuesta: Node 26 si Next.js/NestJS/dependencias nativas lo soportan en SPIKE-08; si no, 24.
2. ~~**Object storage local**~~ — resuelto por SPIKE-07: SeaweedFS 4.48 (`weed mini`). Pregunta original: **Object storage local:** SeaweedFS (candidato) vs Garage vs RustFS — SPIKE-07. ¿Se acepta actualizar ARCHITECTURE §10 para no nombrar MinIO como primera opción?
3. **`keycloak-db` en ARCHITECTURE §10** aparece como volumen; se propone corregir a "base de datos `keycloak` en `postgres`".
4. **Profile `tools`:** ¿se incorpora (cliente web de BD) o se deja fuera?
5. ~~**Placeholders en el realm import**~~ — resuelto: Keycloak los sustituye al importar (§10). Pregunta original: **Placeholders en el realm import** de Keycloak: confirmar en SPIKE-06 o usar render previo.
6. **Docker Desktop vs alternativas** (licencia de Docker Desktop para uso personal es gratuita; Rancher/Podman no se soportan oficialmente): ¿se exige Docker Desktop?
7. **Ubicación del repo:** ¿mover el repo de `D:\projects` a WSL2 para habilitar Modo C y Dev Containers con buen rendimiento?
8. ~~**Valkey vs Redis**~~ — resuelto: Valkey 9.1 en el perfil opcional `valkey`. Pregunta original: se propone Valkey 8 (licencia BSD) por paridad con ElastiCache for Valkey ([21-cloud-deployment-options.md](21-cloud-deployment-options.md)).

## Guion de demo con datos de demostración (add-demo-data)

1. `pnpm stack:up` + `pnpm db:migrate` + `pnpm db:seed` (Minimal) e iniciar sesión como `owner@demo.pfos.test`.
2. Configuración del espacio → **Datos de demostración** → "Cargar datos de demostración" (confirmar). Se crea "Demo — Finanzas de
   Valeria" (workspace separado; W1 no cambia) y la carga corre en el worker (< 2 min, progreso visible).
3. "Ir al espacio de demostración": Home, cuentas, transacciones y Cripto/FX con 21 meses de datos ficticios; el indicador
   "Datos de demostración" aparece en toda pantalla y el selector etiqueta el workspace.
4. Al terminar: Configuración → "Limpiar datos de demostración" (confirmar). El demo desaparece al instante y el worker lo purga.
   Alternativa sin UI: `pnpm db:seed -- --profile=demo`. `DEMO_DATA_ENABLED=false` oculta la carga (por defecto en staging/production).

