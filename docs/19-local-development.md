# 19 — Entorno de desarrollo local

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Relacionado:** [ARCHITECTURE.md](ARCHITECTURE.md) §6, §10, §11, §15 · [07-c4-architecture.md](07-c4-architecture.md) · [12-security.md](12-security.md) · [16-testing-strategy.md](16-testing-strategy.md) · [18-observability.md](18-observability.md) · [20-container-strategy.md](20-container-strategy.md) · [23-ci-cd.md](23-ci-cd.md) · [29-seed-datasets.md](29-seed-datasets.md) · [30-backup-and-disaster-recovery.md](30-backup-and-disaster-recovery.md) · ADR-0011, ADR-0012 · Spec: `openspec/changes/bootstrap-platform-foundation/specs/platform/local-environment/spec.md` · SPIKE-07, SPIKE-08

> **Phase 0 = solo diseño.** Todo `compose.yaml`, `.env.example`, script o fichero de configuración de este documento es **ilustrativo**. Se materializa en `deploy/compose/`, `scripts/` y raíz del repo tras el DESIGN GATE, validado por SPIKE-07 (object storage) y SPIKE-08 (Compose en Windows/WSL2).

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
| Runtime de la aplicación | sin prefijo, por dominio | apps (vía esquema) | `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `SMTP_URL`, `JOB_QUEUE_DRIVER`, `SESSION_STORE`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE=es-BO`, `APP_REPORTING_CURRENCY=BOB`, `APP_TIMEZONE=America/La_Paz` |

4. **Un solo `.env` en la raíz** (copiado de `.env.example`), leído por Compose y por los procesos del host. Los valores del `.env` son los del **modo A** y se derivan de los puertos `PF_*` por interpolación:
   ```dotenv
   PF_POSTGRES_PORT=25432
   DATABASE_URL=postgres://pf_app:${PF_DEV_DB_PASSWORD}@127.0.0.1:${PF_POSTGRES_PORT}/pfos
   OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:${PF_OBJECT_STORAGE_PORT}
   ```
5. **Modo B sobrescribe solo las direcciones** en el bloque `environment:` de cada servicio de `compose.yaml` (nombres de servicio y puertos internos canónicos): `DATABASE_URL=postgres://pf_app:${PF_DEV_DB_PASSWORD}@postgres:5432/pfos`, `OBJECT_STORAGE_ENDPOINT=http://object-storage:8333`. El resto de variables se hereda del mismo `.env` → no hay dos configuraciones que mantener.
6. **Toggles de dependencias**, no ramas de código: `JOB_QUEUE_DRIVER=pgboss|bullmq`, `SESSION_STORE=postgres|valkey`, `OTEL_ENABLED=true|false`, `OTEL_NODE_RESOURCE_DETECTORS=env,os,serviceinstance` (obligatorio, SPIKE-10). El adapter se elige en el composition root; el dominio no se entera.
7. **Secretos:** `.env.example` solo contiene placeholders de desarrollo marcados `PF_DEV_*` (generados por `pnpm setup:env` con valores aleatorios en el primer arranque). Nunca en imágenes, nunca en el repo; en cloud se inyectan desde el secrets manager como variables con el **mismo nombre**.
8. **Sin `localhost` en el código:** toda dirección viene del esquema. `localhost`/`127.0.0.1` solo aparece como *valor* en `.env.example` (modo A).

### 0.4 Dockerización

- **Una imagen por desplegable**, multi-stage, target `runtime` non-root: `finance-api` (comandos `api | worker | migrate | seed`), `finance-web`, `finance-ml` (Phase 8). **No existen Dockerfiles de desarrollo**: el modo B usa la imagen de producción.
- Todos los contenedores de app: `init: true`, `ENTRYPOINT` en forma exec, handler de SIGTERM, `stop_grace_period`, healthcheck sobre `/health/ready` (SPIKE-08).
- Imágenes de terceros fijadas por versión **y digest** (p. ej. SeaweedFS `mini`, SPIKE-07); prohibidas imágenes Bitnami.
- Profiles: `deps`, `core`, `seed`, `observability`, `ml` y **`valkey`** (solo si `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey`; ya no forma parte de `deps`/`core`).
- Todos los puertos publicados en `${PF_BIND_ADDR}:${PF_<SVC>_PORT}`; dentro de la red Compose se usan los puertos canónicos.
- Volúmenes nombrados por proyecto (`pfos_pg-data`, `pfos_object-storage-data`); nombre de proyecto Compose fijo `pfos` para no mezclarse con otros proyectos de la máquina.
- Futuro opcional: `compose.dev.yaml` con `develop.watch` para quien mueva el repo a WSL2 (no es el camino principal).

### 0.5 Comandos (todos TypeScript vía `pnpm`, funcionan igual en PowerShell y Git Bash)

| Comando | Modo | Efecto |
|---|---|---|
| `pnpm setup:env` | — | Crea `.env` desde `.env.example` con secretos de desarrollo aleatorios; detecta puertos ocupados y sugiere alternativas |
| `pnpm stack:up` | A | Levanta `deps` y espera healthy |
| `pnpm dev` | A | `migrate` + api/worker/web en el host con `node --watch` |
| `pnpm stack:up -- --profile core` | B | Producto completo en contenedores |
| `pnpm stack:down` / `stack:restart` / `stack:logs [svc]` | A/B | Ciclo de vida |
| `pnpm stack:reset -- --seed=minimal\|demo\|large` | A/B | Borra volúmenes → migraciones → seed |
| `pnpm db:migrate` / `db:seed` | A/B | `compose run --rm migrate|seed` |
| `pnpm test:integration` | — | Testcontainers (independiente del stack) |
| `pnpm backup:local` / `restore:local` | A/B | pg_dump + mirror de object storage |

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
| Un comando para todo el producto | `pnpm stack:up` (profile `core`) |
| Solo levantar lo necesario | Compose **profiles** `deps`, `core`, `seed`, `observability`, `ml` (+ `tools` opcional, ver §4.6) |
| Cross-platform (owner en **Windows**) | Scripts TypeScript ejecutados con `tsx` vía `pnpm`; **cero scripts solo-bash** (ADR-0012) |
| Paridad con cloud | Las mismas imágenes `finance-web` / `finance-api` que CI promueve a staging/producción ([20-container-strategy.md](20-container-strategy.md)) |
| 12-factor | Configuración 100 % por env vars; `.env.example` sin secretos; hostnames de servicio Compose, nunca `localhost` hardcodeado |
| Arranque determinista | `healthcheck` en cada servicio de larga vida; `depends_on` con `service_healthy` y `service_completed_successfully` (para `migrate`) |
| Datos persistentes y reseteables | Volúmenes nombrados + `pnpm stack:reset` (BD limpia → migraciones → seed → arranque) |

## 2. Prerrequisitos

### 2.1 Windows 11 (entorno principal del owner)

| Herramienta | Versión mínima propuesta | Notas |
|---|---|---|
| **WSL2** | kernel actual (`wsl --update`) | Requerido por Docker Desktop (backend WSL2). Recomendada distro Ubuntu LTS para clonar el repo *dentro* del filesystem Linux (ver §11.2). |
| **Docker Desktop** | 4.x reciente con Compose v2 ≥ 2.24 | Necesario para `depends_on.required`, `restart: true`, `healthcheck.start_interval`, `develop.watch`. Asignar ≥ 6 GB RAM / 4 CPU a WSL2 (`%UserProfile%\.wslconfig`). Alternativas: Rancher Desktop / Podman Desktop (no soportadas oficialmente; ver Preguntas abiertas). |
| **Node.js LTS** | Node 24 (Active LTS hasta 2026-10-20) o **Node 26** (pasa a LTS el 2026-10-28) | Fijado en `.nvmrc`/`.node-version` y `engines`. Decisión de línea exacta en Preguntas abiertas y [20-container-strategy.md](20-container-strategy.md) §3. Instalar con `fnm` o `nvm-windows`/`volta`. |
| **pnpm** | vía **corepack** (`corepack enable`) | Versión fijada en `package.json#packageManager` (`pnpm@<x.y.z>`); nunca `npm i -g pnpm`. Nota: corepack deja de venir incluido en futuras líneas de Node; si falta, `npm i -g corepack` (verificar en SPIKE-08). |
| **Git** | 2.4x con `core.autocrlf=false` | Line endings gobernados por `.gitattributes` (§11.1). |
| IDE | VS Code / WebStorm | Extensión *WSL* o *Dev Containers* si se usa §12. |

> No se requiere instalar PostgreSQL, Redis/Valkey, Keycloak ni Python en el host: todo corre en contenedores.

### 2.2 macOS / Linux

Docker Desktop, OrbStack o Docker Engine + plugin Compose v2; Node LTS; corepack. Mismos comandos.

### 2.3 Verificación

```powershell
# PowerShell o bash — mismo comando
pnpm doctor
```

`pnpm doctor` (`scripts/doctor.ts`) comprueba: versión de Node vs `engines`, pnpm vía corepack, `docker version` y `docker compose version` (≥ 2.24), memoria asignada a Docker, puertos libres (§11.3), presencia de `.env`, `core.autocrlf`, y en Windows si el repo está en `/mnt/c` (advertencia de rendimiento).

## 3. Flujo de arranque: clone → install → stack:up

```mermaid
flowchart LR
  A[git clone] --> B[corepack enable]
  B --> C[pnpm install]
  C --> D[pnpm env:init<br/>.env desde .env.example<br/>+ credenciales dev aleatorias]
  D --> E[pnpm stack:up<br/>profile core]
  E --> F{servicios healthy}
  F --> G[pnpm db:seed -- --profile=minimal]
  G --> H[http://localhost:3000<br/>login con usuario dev]
```

```powershell
git clone https://github.com/<owner>/personal-finances.git
cd personal-finances
corepack enable
pnpm install
pnpm env:init          # crea .env (no versionado) y genera passwords dev aleatorios
pnpm stack:up          # build/pull imágenes y arranca profile core
pnpm db:seed -- --profile=minimal
pnpm stack:logs -- finance-api
```

Secuencia interna de `stack:up` (profile `core`):

```mermaid
sequenceDiagram
  participant S as pnpm stack:up
  participant C as docker compose
  participant PG as postgres
  participant R as redis
  participant OS as object-storage
  participant KC as keycloak
  participant M as migrate (one-shot)
  participant API as finance-api
  participant W as finance-worker
  participant WEB as finance-web
  S->>C: compose --profile core up -d --wait
  C->>PG: start (healthcheck pg_isready)
  C->>R: start (healthcheck PING)
  C->>OS: start (healthcheck HTTP)
  PG-->>C: healthy
  C->>KC: start (depends_on postgres healthy, realm import)
  C->>M: run migrate (depends_on postgres, object-storage healthy)
  M-->>C: exit 0 (service_completed_successfully)
  C->>API: start (depends_on migrate completed + deps healthy)
  C->>W: start (idem)
  API-->>C: healthy (/health/ready)
  C->>WEB: start (depends_on finance-api healthy, keycloak healthy)
  WEB-->>C: healthy
  C-->>S: --wait devuelve 0 → imprime URLs
```

Si `migrate` falla, `finance-api` y `finance-worker` **no arrancan** y `stack:up` termina con código ≠ 0 mostrando los logs de `migrate` (scenario *Migrations gate the API*).

## 4. Profiles de Compose

| Profile | Servicios | Cuándo usarlo |
|---|---|---|
| `deps` | `postgres`, `redis`, `object-storage`, `mailpit`, `keycloak` | **Desarrollo diario con hot reload**: apps corren en el host (`pnpm dev`) contra dependencias en contenedores. Más rápido en Windows (sin bind mounts de código). |
| `core` | `deps` + `migrate`, `finance-api`, `finance-worker`, `finance-web` | Producto completo en contenedores: demo, verificación pre-PR, E2E, compose smoke (paridad con cloud). |
| `seed` | `seed` (one-shot) | Cargar datasets `minimal`/`demo`/`large`. Siempre invocado por `pnpm db:seed` junto con `core`. |
| `observability` | `otel-lgtm` | Ver traces/metrics/logs locales (Grafana en `:3001`). Combinable con `deps` o `core`. Detalle en [18-observability.md](18-observability.md). |
| `ml` | `ml-forecasting` | Solo desde Phase 8 (forecasting Python). |
| `tools` *(propuesta, no canónica)* | p. ej. `db-admin` (pgweb/CloudBeaver) | Opcional; ver §4.6 y Preguntas abiertas. |

> Los servicios de `deps` declaran `profiles: [deps, core]`, de modo que `--profile core` incluye dependencias sin necesidad de pasar ambos profiles.

### 4.1 Modo A — `deps` + apps en el host (recomendado para codificar)

```mermaid
flowchart LR
  subgraph Host[Host Windows / WSL2]
    WEBH[pnpm --filter web dev<br/>Next.js :3000 HMR]
    APIH[pnpm --filter api dev:api<br/>Nest :8080 watch]
    WH[pnpm --filter api dev:worker]
  end
  subgraph Docker[Docker - profile deps]
    PG[(postgres :5432)]
    RD[(redis :6379)]
    OS[(object-storage :9000/9001)]
    KC[keycloak :8081]
    MP[mailpit :8025/1025]
  end
  WEBH --> APIH
  WEBH --> KC
  APIH --> PG & RD & OS & KC & MP
  WH --> PG & RD & OS & MP
```

```powershell
pnpm stack:up -- --profile=deps
pnpm db:migrate              # ejecuta dbmate desde el host contra localhost:5432
pnpm dev                     # turbo run dev --filter=web --filter=api (api + worker + web)
```

En este modo la app lee **`.env.host`** (generado por `pnpm env:init`) donde las URLs apuntan a `localhost:<puerto publicado>`. No es "localhost hardcodeado": es configuración (§6.3). Los puertos publicados son los defaults de ARCHITECTURE §10, sobrescribibles con `HOST_PORT_*`.

### 4.2 Modo B — `core` (todo en contenedores)

```powershell
pnpm stack:up                       # = --profile=core
pnpm stack:up -- --profile=core --profile=observability
```

Las apps se comunican por hostnames de servicio (`postgres`, `redis`, `object-storage`, `keycloak`, `finance-api`). Se usa la imagen construida localmente (`pnpm images:build`) o una imagen publicada (`FINANCE_API_IMAGE=…@sha256:…`) para reproducir exactamente lo desplegado.

### 4.3 Modo C — `core` + Compose Watch (opcional)

Para depurar comportamiento solo-contenedor con recarga, un override `compose.watch.yaml` usa `develop.watch` (`action: sync` para `apps/*/src`, `action: rebuild` para `package.json`/`pnpm-lock.yaml`). En Windows es fiable solo con el repo dentro de WSL2 (§11.2). Se evaluará en SPIKE-08; no es el camino principal.

### 4.4 `seed`

`pnpm db:seed -- --profile=minimal|demo|large` ejecuta `docker compose --profile core --profile seed run --rm seed --profile=<p>` (o en Modo A, `tsx scripts/db-seed.ts` directamente). Ver §8.

### 4.5 `observability` y `ml`

`otel-lgtm` recibe OTLP en `4317` (gRPC) y `4318` (HTTP). Las apps exportan solo si `OTEL_EXPORTER_OTLP_ENDPOINT` está definido; sin el profile, el SDK queda en no-op (no falla). `ml-forecasting` es Phase 8 y **nunca** es dependencia de `finance-api` (ARCHITECTURE §2).

### 4.6 `tools` (propuesta)

Un profile `tools` con un cliente web de PostgreSQL facilitaría inspección sin instalar nada. No figura en ARCHITECTURE §10; se propone como opcional y **no** se incluye en el compose canónico hasta aprobarse (Preguntas abiertas).

## 5. `compose.yaml` propuesto (ilustrativo)

Ubicación objetivo: `deploy/compose/compose.yaml`, proyecto Compose `pfos`. El servicio `object-storage` usa **SeaweedFS** como candidato de trabajo porque MinIO community quedó sin mantenimiento y sin imágenes oficiales (ver §5.2); la decisión final es de **SPIKE-07** (ADR-0009). El puerto de host sigue siendo `9000`/`9001` según ARCHITECTURE §10, independientemente de la implementación.

```yaml
# deploy/compose/compose.yaml — ILUSTRATIVO (Phase 0). Materializar tras DESIGN GATE.
name: pfos

x-app-common: &app-common
  env_file:
    - path: ../../.env            # generado por `pnpm env:init`, no versionado
      required: true
  init: true                      # tini como PID 1: reenvía señales y recolecta zombies
  stop_signal: SIGTERM
  stop_grace_period: 30s          # > timeout interno de shutdown de la app (25 s)
  restart: unless-stopped
  networks: [pfos]
  security_opt: ["no-new-privileges:true"]
  read_only: true
  tmpfs: ["/tmp:size=64m"]
  cap_drop: [ALL]
  logging: &default-logging
    driver: local
    options: { max-size: "10m", max-file: "3" }

x-deps-common: &deps-common
  profiles: [deps, core]
  restart: unless-stopped
  networks: [pfos]
  logging: *default-logging
  stop_grace_period: 20s

services:
  # ───────────────────────── deps ─────────────────────────
  postgres:
    <<: *deps-common
    image: postgres:18-bookworm@sha256:<digest>      # minor fijada por Renovate (18.x)
    environment:
      POSTGRES_USER: ${PG_SUPERUSER:-pfos_admin}
      POSTGRES_PASSWORD: ${PG_SUPERUSER_PASSWORD:?run pnpm env:init}
      POSTGRES_DB: ${PG_DATABASE:-pfos}
      # Roles de app/migración/keycloak creados por init scripts (sin BYPASSRLS para app)
      PFOS_MIGRATOR_PASSWORD: ${DATABASE_MIGRATOR_PASSWORD:?}
      PFOS_APP_PASSWORD: ${DATABASE_APP_PASSWORD:?}
      KEYCLOAK_DB_PASSWORD: ${KEYCLOAK_DB_PASSWORD:?}
    command: >
      postgres -c shared_preload_libraries=pg_stat_statements
               -c log_min_duration_statement=500
               -c max_connections=100
    volumes:
      - pg-data:/var/lib/postgresql          # PG 18 image: PGDATA bajo /var/lib/postgresql/18/docker (verificar SPIKE-08)
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
      - ../../.backups:/backups               # destino de backup:local / restore:local
    ports: ["${HOST_PORT_POSTGRES:-5432}:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 20s
      start_interval: 1s
    shm_size: 256m
    deploy:
      resources:
        limits: { cpus: "2", memory: 1g }

  redis:
    <<: *deps-common
    image: valkey/valkey:8-bookworm@sha256:<digest>   # compatible protocolo Redis
    command: ["valkey-server", "--appendonly", "yes", "--maxmemory", "256mb",
              "--maxmemory-policy", "noeviction"]      # BullMQ exige noeviction
    volumes: [redis-data:/data]
    ports: ["${HOST_PORT_REDIS:-6379}:6379"]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s   # Docker 29 rechaza start_interval sin start_period (SPIKE-08)
      start_interval: 1s
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 320m }

  object-storage:
    <<: *deps-common
    image: chrislusf/seaweedfs:<version>@sha256:<digest>   # candidato; decide SPIKE-07
    command: ["mini", "-dir=/data", "-s3.port=8333", "-s3.config=/etc/seaweedfs/s3.json"]
    environment:
      OBJECT_STORAGE_ACCESS_KEY: ${OBJECT_STORAGE_ACCESS_KEY:?}
      OBJECT_STORAGE_SECRET_KEY: ${OBJECT_STORAGE_SECRET_KEY:?}
    volumes:
      - object-storage-data:/data
      - ./object-storage/s3.json:/etc/seaweedfs/s3.json:ro   # credenciales vía env (plantilla)
    ports:
      - "${HOST_PORT_OBJECT_STORAGE:-9000}:8333"            # API S3
      - "${HOST_PORT_OBJECT_STORAGE_UI:-9001}:23646"        # UI admin (puerto exacto: SPIKE-07)
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8333/healthz || exit 1"]  # endpoint exacto: SPIKE-07
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 15s
    deploy:
      resources:
        limits: { cpus: "1", memory: 512m }

  mailpit:
    <<: *deps-common
    image: axllent/mailpit:<version>@sha256:<digest>
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
      MP_MAX_MESSAGES: "2000"
    ports:
      - "${HOST_PORT_MAILPIT_UI:-8025}:8025"
      - "${HOST_PORT_MAILPIT_SMTP:-1025}:1025"
    healthcheck:
      test: ["CMD", "/mailpit", "readyz"]
      interval: 10s
      timeout: 3s
      retries: 5
    deploy:
      resources:
        limits: { cpus: "0.25", memory: 128m }

  keycloak:
    <<: *deps-common
    image: quay.io/keycloak/keycloak:26.<x>@sha256:<digest>
    command: ["start-dev", "--import-realm", "--http-port=8080"]
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: ${KEYCLOAK_DB_PASSWORD:?}
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KEYCLOAK_ADMIN_USER:-admin}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:?}
      KC_HEALTH_ENABLED: "true"                     # /health/* en management port 9000
      KC_HOSTNAME: ${OIDC_PUBLIC_BASE_URL:?}        # p. ej. http://localhost:8081 (URL vista por el navegador)
      KC_HOSTNAME_BACKCHANNEL_DYNAMIC: "true"        # back-channel por http://keycloak:8080 dentro de la red
      # Variables consumidas por placeholders del realm (dev-only)
      PFOS_DEV_OWNER_PASSWORD: ${PFOS_DEV_OWNER_PASSWORD:?}
      PFOS_DEV_EDITOR_PASSWORD: ${PFOS_DEV_EDITOR_PASSWORD:?}
      PFOS_DEV_VIEWER_PASSWORD: ${PFOS_DEV_VIEWER_PASSWORD:?}
      PFOS_WEB_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:?}
      PFOS_WEB_PUBLIC_URL: ${WEB_PUBLIC_URL:?}
    volumes:
      - ./keycloak/realm-pfos-dev.json:/opt/keycloak/data/import/realm-pfos-dev.json:ro
    ports: ["${HOST_PORT_KEYCLOAK:-8081}:8080"]
    depends_on:
      postgres: { condition: service_healthy, restart: true }
    healthcheck:
      # La imagen no trae curl/wget: TCP + HTTP con bash (/dev/tcp)
      test: ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/9000 && printf 'GET /health/ready HTTP/1.1\\r\\nHost: kc\\r\\nConnection: close\\r\\n\\r\\n' >&3 && grep -q '\"UP\"' <&3"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 60s
    deploy:
      resources:
        limits: { cpus: "1.5", memory: 1g }

  # ───────────────────────── core ─────────────────────────
  migrate:
    <<: *app-common
    profiles: [core]
    image: ${FINANCE_API_IMAGE:-pfos/finance-api:local}
    build: &api-build
      context: ../..
      dockerfile: docker/finance-api.Dockerfile
      target: runtime
    command: ["migrate"]               # entrypoint: dbmate up + ensure buckets (solo si OBJECT_STORAGE_ENSURE_BUCKETS=true)
    restart: "no"
    environment:
      PFOS_PROCESS: migrate
      DATABASE_URL: postgres://pfos_migrator:${DATABASE_MIGRATOR_PASSWORD}@postgres:5432/${PG_DATABASE:-pfos}?sslmode=disable
    depends_on:
      postgres: { condition: service_healthy }
      object-storage: { condition: service_healthy }
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 256m }

  finance-api:
    <<: *app-common
    profiles: [core]
    image: ${FINANCE_API_IMAGE:-pfos/finance-api:local}
    build: *api-build
    command: ["api"]
    environment:
      PFOS_PROCESS: api
      HTTP_PORT: "8080"
    ports: ["${HOST_PORT_API:-8080}:8080"]
    depends_on: &app-deps
      migrate: { condition: service_completed_successfully }
      postgres: { condition: service_healthy, restart: true }
      redis: { condition: service_healthy, restart: true }
      object-storage: { condition: service_healthy }
      keycloak: { condition: service_healthy }
      mailpit: { condition: service_started }
    healthcheck:
      test: ["CMD", "node", "dist/healthcheck.js", "http://127.0.0.1:8080/health/ready"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 30s
      start_interval: 2s
    deploy:
      resources:
        limits: { cpus: "1", memory: 768m }

  finance-worker:
    <<: *app-common
    profiles: [core]
    image: ${FINANCE_API_IMAGE:-pfos/finance-api:local}
    build: *api-build
    command: ["worker"]
    environment:
      PFOS_PROCESS: worker
      WORKER_HEALTH_PORT: "8082"        # solo red interna, no publicado
      WORKER_SHUTDOWN_TIMEOUT_MS: "25000"
    depends_on: *app-deps
    healthcheck:
      test: ["CMD", "node", "dist/healthcheck.js", "http://127.0.0.1:8082/health/ready"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 30s
    stop_grace_period: 45s              # jobs largos (imports) — ver 20-container-strategy.md §6
    deploy:
      resources:
        limits: { cpus: "1", memory: 768m }

  finance-web:
    <<: *app-common
    profiles: [core]
    image: ${FINANCE_WEB_IMAGE:-pfos/finance-web:local}
    build:
      context: ../..
      dockerfile: docker/finance-web.Dockerfile
      target: runtime
    environment:
      PORT: "3000"
      HOSTNAME: "0.0.0.0"
      API_INTERNAL_BASE_URL: http://finance-api:8080     # BFF → API dentro de la red
    ports: ["${HOST_PORT_WEB:-3000}:3000"]
    tmpfs: ["/tmp:size=64m", "/app/apps/web/.next/cache:size=256m"]
    depends_on:
      finance-api: { condition: service_healthy }
      keycloak: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "healthcheck.js", "http://127.0.0.1:3000/api/health/ready"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 20s
    deploy:
      resources:
        limits: { cpus: "1", memory: 768m }

  # ───────────────────────── seed ─────────────────────────
  seed:
    <<: *app-common
    profiles: [seed]
    image: ${FINANCE_API_IMAGE:-pfos/finance-api:local}
    build: *api-build
    command: ["seed", "--profile=minimal"]   # sobrescrito por `pnpm db:seed -- --profile=…`
    restart: "no"
    environment:
      PFOS_PROCESS: seed
      DATABASE_URL: postgres://pfos_migrator:${DATABASE_MIGRATOR_PASSWORD}@postgres:5432/${PG_DATABASE:-pfos}?sslmode=disable
    depends_on:
      migrate: { condition: service_completed_successfully }
      keycloak: { condition: service_healthy }   # el seed resuelve los `sub` de los usuarios dev

  # ───────────────────────── observability ─────────────────────────
  otel-lgtm:
    profiles: [observability]
    image: grafana/otel-lgtm:<version>@sha256:<digest>
    networks: [pfos]
    ports:
      - "${HOST_PORT_GRAFANA:-3001}:3000"
      - "${HOST_PORT_OTLP_GRPC:-4317}:4317"
      - "${HOST_PORT_OTLP_HTTP:-4318}:4318"
    volumes: [otel-lgtm-data:/data]
    healthcheck:
      test: ["CMD-SHELL", "curl -fs http://127.0.0.1:3000/api/health || exit 1"]
      interval: 15s
      retries: 10
      start_period: 30s
    deploy:
      resources:
        limits: { cpus: "1", memory: 1g }

  # ───────────────────────── ml (Phase 8) ─────────────────────────
  ml-forecasting:
    <<: *app-common
    profiles: [ml]
    image: ${FINANCE_ML_IMAGE:-pfos/finance-ml:local}
    build:
      context: ../../services/ml-forecasting
      dockerfile: ../../docker/finance-ml.Dockerfile
    ports: ["${HOST_PORT_ML:-8090}:8090"]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8090/health/ready', timeout=2)"]
      interval: 15s
      retries: 6
      start_period: 30s
    deploy:
      resources:
        limits: { cpus: "2", memory: 2g }

networks:
  pfos:
    name: pfos
    driver: bridge

volumes:
  pg-data:
  redis-data:
  object-storage-data:
  otel-lgtm-data:
```

### 5.1 Notas de diseño del compose

- **`127.0.0.1` en healthchecks**: se ejecutan *dentro* del propio contenedor (loopback del contenedor), no son direcciones de servicio. El escáner de "no hardcoded localhost" (spec `local-environment`) excluye el bloque `healthcheck` — regla a configurar en el script de verificación.
- **Inyección de URLs de conexión**: el `.env` contiene `DATABASE_URL`, `REDIS_URL`, `OBJECT_STORAGE_ENDPOINT`, etc. con hostnames de servicio (§6). `migrate` y `seed` sobrescriben `DATABASE_URL` para usar el **rol de migración** (`pfos_migrator`, owner de tablas); `finance-api` y `finance-worker` usan `pfos_app` (sin `BYPASSRLS`, no owner) — ARCHITECTURE §9.
- **`keycloak-db`**: ARCHITECTURE §10 lo lista entre volúmenes, pero no es un volumen: es la **base de datos `keycloak` dentro de `postgres`** (persistida en `pg-data`), creada por `postgres/init/01-roles-and-databases.sql`. Ver Preguntas abiertas.
- **`redis-data`** es opcional: Valkey local con AOF evita perder jobs en un reinicio, pero Redis se trata como **no durable/reconstruible** (ver [30-backup-and-disaster-recovery.md](30-backup-and-disaster-recovery.md)).
- **`deploy.resources.limits`**: Compose v2 lo aplica sin Swarm. Los límites suman ≈ 7.5 CPU / 6.5 GB en el peor caso con todos los profiles; con `core` ≈ 5 GB.
- **`read_only: true` + `tmpfs`** en apps: valida desde local la compatibilidad con FS de solo lectura que se usará en ECS (`readonlyRootFilesystem`).
- **`restart: true`** en `depends_on` reinicia la app si Compose reinicia `postgres`/`redis` (Compose ≥ 2.17).
- **Keycloak issuer**: el navegador ve `http://localhost:8081` (URL pública configurable vía `OIDC_PUBLIC_BASE_URL`); BFF y API resuelven JWKS/token por `http://keycloak:8080`. Por eso se separan `OIDC_ISSUER` (valor esperado del claim `iss`) y `OIDC_INTERNAL_BASE_URL` (§6). Validar en SPIKE-06.
- **Buckets**: `migrate` ejecuta, además de `dbmate up`, un paso idempotente `storage:ensure-buckets` solo si `OBJECT_STORAGE_ENSURE_BUCKETS=true` (local/CI). En cloud los buckets los crea Terraform ([22-infrastructure.md](22-infrastructure.md)).

### 5.2 Estado de MinIO y alternativas (verificado 2026-10-01)

| Opción | Estado (aprox., fuentes públicas) | Encaje local |
|---|---|---|
| MinIO community | Dejó de publicar binarios/imágenes oficiales en oct-2025; "maintenance mode" (dic-2025) y repo archivado/no mantenido (feb-2026). Reportes indican que el namespace `minio/*` de Docker Hub dejó de servir imágenes en sep-2026; quedan tags históricos en `quay.io/minio/minio`. Consola community recortada desde 2025. | **Descartado** como default: sin parches de seguridad. |
| **SeaweedFS** (Apache-2.0) | Activo; `weed mini` arranca todo en un proceso para dev. | Candidato principal (imagen única, S3 + presigned URLs). |
| **Garage** (AGPL-3.0, servidor no se distribuye con el producto) | Activo (v2.x en 2026); requiere bootstrap de layout/keys (un one-shot extra). | Alternativa sólida; ligera. |
| RustFS (Apache-2.0) | 1.0 GA (sep-2026), proyecto joven. | Vigilar. |

SPIKE-07 valida: presigned PUT/GET con el SDK v3 de AWS, `forcePathStyle`, checksums (`x-amz-checksum-*` por defecto en SDK v3 recientes), CORS para subida directa desde el navegador, versionado (para paridad con S3) y comportamiento de multipart.

## 6. Variables de entorno

### 6.1 Convenciones

- `UPPER_SNAKE_CASE`; prefijo por componente: `PG_*` (contenedor postgres), `DATABASE_*` (app), `REDIS_*`, `OBJECT_STORAGE_*`, `OIDC_*`, `SMTP_*`, `WEB_*`, `API_*`, `WORKER_*`, `HOST_PORT_*` (solo Compose), `PFOS_*` (globales del producto), `OTEL_*` (**variables estándar** de OpenTelemetry, sin prefijo propio).
- `NEXT_PUBLIC_*` **jamás** contiene secretos ni URLs internas (se embebe en el bundle del navegador). El BFF lee config server-side en runtime (no en build) para cumplir *build once* ([20-container-strategy.md](20-container-strategy.md) §7).
- Toda variable se valida al arrancar con un schema (`zod`) en `@pf/platform/config`; variable faltante o inválida ⇒ el proceso termina con código 78 (`EX_CONFIG`) y mensaje claro, sin imprimir valores.
- Secretos: sufijo `_PASSWORD`, `_SECRET`, `_KEY`, `_TOKEN`. El logger redacta claves con esos sufijos.
- Ficheros: `.env.example` (versionado, sin secretos), `.env` (Compose/contenedores, ignorado), `.env.host` (Modo A, ignorado), `.env.test` (CI/Testcontainers, generado).
- `PFOS_ENV` ∈ `local | ci | staging | production`. Comportamientos dev-only (`OBJECT_STORAGE_ENSURE_BUCKETS`, realm import, seeds) se **rechazan** si `PFOS_ENV ∈ {staging, production}`.

### 6.2 `.env.example` (ilustrativo)

```dotenv
# ─────────────────────────────────────────────────────────────────────────────
# PFOS — .env.example  (VERSIONADO, SIN SECRETOS)
# `pnpm env:init` copia este fichero a .env y reemplaza cada __GENERATE__ por un
# valor aleatorio (crypto.randomBytes). Todas las credenciales son SOLO PARA DEV
# LOCAL. Nunca reutilizarlas en otro entorno ni en otro servicio.
# ─────────────────────────────────────────────────────────────────────────────
PFOS_ENV=local
TZ=UTC
LOG_LEVEL=info
LOG_FORMAT=json                 # json | pretty (pretty solo en Modo A)

# ── PostgreSQL (contenedor) ──
PG_DATABASE=pfos
PG_SUPERUSER=pfos_admin
PG_SUPERUSER_PASSWORD=__GENERATE__          # dev-only
DATABASE_MIGRATOR_PASSWORD=__GENERATE__     # dev-only, rol pfos_migrator (owner de schemas)
DATABASE_APP_PASSWORD=__GENERATE__          # dev-only, rol pfos_app (sin BYPASSRLS)

# ── App → PostgreSQL ──
DATABASE_URL=postgres://pfos_app:${DATABASE_APP_PASSWORD}@postgres:5432/pfos?sslmode=disable
DATABASE_POOL_MAX=10
DATABASE_STATEMENT_TIMEOUT_MS=15000

# ── Redis / Valkey ──
REDIS_URL=redis://redis:6379/0
QUEUE_PREFIX=pfos

# ── Object storage (API S3) ──
OBJECT_STORAGE_ENDPOINT=http://object-storage:8333
OBJECT_STORAGE_PUBLIC_ENDPOINT=http://localhost:9000   # URL de presigned URLs vista por el navegador
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_BUCKET_DOCUMENTS=pfos-local-documents
OBJECT_STORAGE_BUCKET_EXPORTS=pfos-local-exports
OBJECT_STORAGE_ACCESS_KEY=pfos-dev
OBJECT_STORAGE_SECRET_KEY=__GENERATE__      # dev-only
OBJECT_STORAGE_ENSURE_BUCKETS=true          # rechazado fuera de local/ci

# ── OIDC (Keycloak dev) ──
OIDC_PUBLIC_BASE_URL=http://localhost:8081
OIDC_ISSUER=http://localhost:8081/realms/pfos
OIDC_INTERNAL_BASE_URL=http://keycloak:8080          # discovery/JWKS/token server-side
OIDC_CLIENT_ID=pfos-web
OIDC_CLIENT_SECRET=__GENERATE__             # dev-only (confidential client del BFF)
OIDC_API_AUDIENCE=pfos-api
KEYCLOAK_DB_PASSWORD=__GENERATE__           # dev-only
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=__GENERATE__        # dev-only
PFOS_DEV_OWNER_PASSWORD=__GENERATE__        # dev-only, usuario owner@pfos.test
PFOS_DEV_EDITOR_PASSWORD=__GENERATE__       # dev-only, usuario editor@pfos.test
PFOS_DEV_VIEWER_PASSWORD=__GENERATE__       # dev-only, usuario viewer@pfos.test

# ── Web (Next.js BFF) ──
WEB_PUBLIC_URL=http://localhost:3000
API_INTERNAL_BASE_URL=http://finance-api:8080
SESSION_COOKIE_SECRET=__GENERATE__          # dev-only, ≥ 32 bytes
SESSION_COOKIE_SECURE=false                 # true en staging/prod (HTTPS)

# ── SMTP (Mailpit) ──
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_FROM="PFOS Dev <no-reply@pfos.test>"

# ── Worker ──
WORKER_CONCURRENCY=4
WORKER_SHUTDOWN_TIMEOUT_MS=25000
OUTBOX_POLL_INTERVAL_MS=500

# ── Producto ──
PFOS_DEFAULT_TIMEZONE=America/La_Paz
PFOS_DEFAULT_BASE_CURRENCY=BOB

# ── OpenTelemetry (vacío = deshabilitado) ──
OTEL_SERVICE_NAMESPACE=pfos
OTEL_EXPORTER_OTLP_ENDPOINT=                # http://otel-lgtm:4318 con profile observability
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_SAMPLER=parentbased_always_on

# ── Imágenes (vacío = build local) ──
FINANCE_API_IMAGE=
FINANCE_WEB_IMAGE=

# ── Puertos de host (defaults ARCHITECTURE §10) ──
HOST_PORT_POSTGRES=5432
HOST_PORT_REDIS=6379
HOST_PORT_OBJECT_STORAGE=9000
HOST_PORT_OBJECT_STORAGE_UI=9001
HOST_PORT_MAILPIT_UI=8025
HOST_PORT_MAILPIT_SMTP=1025
HOST_PORT_KEYCLOAK=8081
HOST_PORT_API=8080
HOST_PORT_WEB=3000
HOST_PORT_GRAFANA=3001
HOST_PORT_OTLP_GRPC=4317
HOST_PORT_OTLP_HTTP=4318
HOST_PORT_ML=8090
```

> El dominio `pfos.test` es un TLD reservado (RFC 2606), sin riesgo de envío real. Gitleaks se configura con allowlist para los literales `__GENERATE__` y `pfos-dev`.

### 6.3 `.env.host` (Modo A)

`pnpm env:init` deriva `.env.host` de `.env` reescribiendo hostnames de servicio por `localhost:${HOST_PORT_*}` (p. ej. `DATABASE_URL=…@localhost:5432/…`, `REDIS_URL=redis://localhost:6379/0`, `OIDC_INTERNAL_BASE_URL=http://localhost:8081`). Las apps cargan `.env.host` solo cuando `PFOS_RUN_MODE=host` (lo fija `pnpm dev`). La transformación vive en un único sitio (script), no en el código de la app.

## 7. Catálogo de scripts (`pnpm`, TypeScript cross-platform)

Implementación en `scripts/*.ts`, ejecutados con `tsx`. Utilidades compartidas en `scripts/lib/` (`compose.ts` construye `docker compose -p pfos -f deploy/compose/compose.yaml --env-file .env …` con `child_process.spawn` y `shell: false`; `paths.ts` usa `node:path`; `confirm.ts` para prompts destructivos con `--yes` para CI). Nada de `rm -rf`, `&&` dependiente de shell, `cp` ni variables `$VAR` en `package.json`.

| Comando | Script | Acción |
|---|---|---|
| `pnpm doctor` | `doctor.ts` | Verifica prerrequisitos (§2.3). |
| `pnpm env:init` | `env-init.ts` | Crea `.env` y `.env.host` desde `.env.example`; genera secretos dev; no sobrescribe sin `--force`. |
| `pnpm stack:up [-- --profile=deps\|core …]` | `stack.ts up` | `compose --profile … up -d --wait --build`; imprime URLs; default `core`. |
| `pnpm stack:down` | `stack.ts down` | `compose down` (conserva volúmenes). |
| `pnpm stack:restart [-- <svc>]` | `stack.ts restart` | Reinicia todo o un servicio. |
| `pnpm stack:logs [-- <svc>] [--since=10m]` | `stack.ts logs` | `compose logs -f`; filtra por servicio. |
| `pnpm stack:ps` | `stack.ts ps` | Estado y health de cada servicio. |
| `pnpm stack:reset [-- --seed=minimal\|demo\|large] [--yes]` | `stack-reset.ts` | Flujo §8.1 (destructivo, pide confirmación). |
| `pnpm db:migrate` | `db-migrate.ts` | Modo B: `compose run --rm migrate`; Modo A: `dbmate up` desde host. |
| `pnpm db:migrate:new -- <context> <name>` | `db-migrate-new.ts` | Crea `db/migrations/<schema>/<timestamp>_<name>.sql` con plantilla expand/contract. |
| `pnpm db:seed -- --profile=minimal\|demo\|large` | `db-seed.ts` | Ejecuta el seed (§8.2). |
| `pnpm db:psql [-- --role=app\|migrator]` | `db-psql.ts` | `compose exec postgres psql` con el rol elegido. |
| `pnpm test` | turbo | Unit + domain + PBT (sin Docker). |
| `pnpm test:integration` | turbo | Testcontainers (requiere Docker; independiente del stack Compose). |
| `pnpm test:e2e` | `e2e.ts` | Levanta `core` + seed `minimal` en proyecto Compose aislado `pfos-e2e`, corre Playwright, baja todo. |
| `pnpm test:platform` | Vitest | Compose smoke ([16-testing-strategy.md](16-testing-strategy.md) §5.11). |
| `pnpm images:build` | `images.ts` | `docker buildx bake` local de `finance-api` y `finance-web`. |
| `pnpm backup:local [-- --name=<label>]` | `backup-local.ts` | Ver §9 y [30-backup-and-disaster-recovery.md](30-backup-and-disaster-recovery.md). |
| `pnpm restore:local -- <backup-id> [--yes]` | `restore-local.ts` | Restaura BD + objetos. |
| `pnpm stack:nuke [--yes]` | `stack.ts nuke` | `down -v --remove-orphans` + borra imágenes locales `pfos/*` (último recurso). |

Esqueleto ilustrativo:

```ts
// scripts/lib/compose.ts — ILUSTRATIVO
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const BASE = ['compose', '-p', 'pfos',
  '-f', resolve(ROOT, 'deploy/compose/compose.yaml'),
  '--env-file', resolve(ROOT, '.env')];

export function compose(args: string[], opts: { profiles?: string[] } = {}): Promise<void> {
  const profileArgs = (opts.profiles ?? ['core']).flatMap((p) => ['--profile', p]);
  return new Promise((ok, fail) => {
    const child = spawn('docker', [...BASE, ...profileArgs, ...args], { stdio: 'inherit', shell: false });
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`docker compose exited ${code}`))));
  });
}
```

```jsonc
// package.json (fragmento) — ILUSTRATIVO
{
  "packageManager": "pnpm@<x.y.z>",
  "engines": { "node": ">=24 <27" },
  "scripts": {
    "doctor": "tsx scripts/doctor.ts",
    "env:init": "tsx scripts/env-init.ts",
    "stack:up": "tsx scripts/stack.ts up",
    "stack:down": "tsx scripts/stack.ts down",
    "stack:restart": "tsx scripts/stack.ts restart",
    "stack:logs": "tsx scripts/stack.ts logs",
    "stack:reset": "tsx scripts/stack-reset.ts",
    "db:migrate": "tsx scripts/db-migrate.ts",
    "db:seed": "tsx scripts/db-seed.ts",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "backup:local": "tsx scripts/backup-local.ts",
    "restore:local": "tsx scripts/restore-local.ts",
    "dev": "tsx scripts/dev.ts"
  }
}
```

## 8. Reset y seeds

### 8.1 `pnpm stack:reset`

```mermaid
flowchart TD
  A[pnpm stack:reset --seed=demo] --> B{confirmación<br/>o --yes}
  B -->|no| X[abort]
  B -->|sí| C[compose --profile core down -v<br/>borra pg-data, redis-data, object-storage-data]
  C --> D[compose --profile deps up -d --wait]
  D --> E[init scripts PG: roles + DB keycloak]
  E --> F[compose run --rm migrate<br/>dbmate up + ensure buckets]
  F --> G[keycloak realm import<br/>usuarios dev]
  G --> H[compose --profile core --profile seed run --rm seed --profile=demo]
  H --> I[compose --profile core up -d --wait]
  I --> J[verificación: /health/ready + conteos esperados del seed]
```

- `--keep-objects` evita borrar `object-storage-data`; `--only-db` recrea solo el schema (drop de schemas de app + re-migrate) sin tocar Keycloak.
- El reset nunca se ejecuta si `PFOS_ENV ≠ local|ci` (guard en el script **y** en el comando `seed` del contenedor).

### 8.2 Perfiles de seed

Definición detallada de datasets en [29-seed-datasets.md](29-seed-datasets.md); aquí solo la mecánica:

| Perfil | Contenido (resumen) | Uso | Tiempo objetivo |
|---|---|---|---|
| `minimal` | 1 workspace (BOB base), owner/editor/viewer, cuentas mínimas (banco BOB, efectivo, wallet USDT, tarjeta), categorías de sistema, unas pocas transacciones incl. una conversión USDT→BOB | E2E, demo rápida, desarrollo diario | < 10 s |
| `demo` | 12–24 meses realistas: presupuestos, recurrentes, deudas, metas | Demos, revisión UX, base de *migration test* (release snapshot) | < 60 s |
| `large` | Volumen para rendimiento (p. ej. ≥ 100k transacciones, varios workspaces) | k6 / pruebas de rendimiento | < 10 min |

Reglas: seeds **deterministas** (PRNG sembrado, `Clock` fijo — regla `pf/no-nondeterminism`), escritos **a través de los casos de uso** de la capa `application` (respetan invariantes del ledger y Audit) y no por SQL crudo; idempotentes por `seed_run` (re-ejecutar no duplica). El seed resuelve el `sub` de cada usuario Keycloak dev para crear `iam.user` + membership.

## 9. Backup / restore local (resumen)

`pnpm backup:local` → `.backups/<UTC timestamp>-<label>/` con `pfos.dump` (`pg_dump -Fc`), `keycloak.dump`, `objects/` (mirror del bucket vía SDK S3) y `manifest.json` (sha256, versión de migraciones, imagen). `pnpm restore:local -- <id>` hace la operación inversa con `pg_restore --clean --if-exists`. Detalle y garantías en [30-backup-and-disaster-recovery.md](30-backup-and-disaster-recovery.md) §3.

## 10. Keycloak: realm de desarrollo

- Fichero: `deploy/compose/keycloak/realm-pfos-dev.json` (versionado, **sin secretos**). Usa placeholders de variables de entorno (`${PFOS_DEV_OWNER_PASSWORD}`), que Keycloak sustituye al importar (comportamiento a confirmar en SPIKE-06; si no aplica, `env-init` renderiza el JSON a `.keycloak/realm.rendered.json` ignorado por git).
- Contenido:
  - Realm `pfos`; client `pfos-web` (confidential, Authorization Code + PKCE S256, redirect `${PFOS_WEB_PUBLIC_URL}/api/auth/callback`, post-logout redirect); audience mapper `pfos-api`.
  - Usuarios: `owner@pfos.test`, `editor@pfos.test`, `viewer@pfos.test` (email verificado, sin required actions). **Los roles de workspace (`OWNER/EDITOR/VIEWER`) NO viven en Keycloak**: los asigna el seed en `iam.membership` (ARCHITECTURE §5, ADR-0010). Keycloak solo autentica.
  - Políticas dev: tokens de acceso 5 min, sesión SSO 10 h, brute-force detection activo (paridad de comportamiento).
- Credenciales: generadas por `pnpm env:init` en `.env`; `pnpm dev:users` las imprime en consola local cuando se necesitan. **Dev-only**, marcadas como tales en `.env.example`. La consola admin de Keycloak (`http://localhost:8081/admin`) usa `KEYCLOAK_ADMIN_*`.
- Export de cambios al realm: `pnpm keycloak:export` (usa `kc.sh export --realm pfos` dentro del contenedor y elimina secretos/usuarios antes de escribir el JSON versionado).

## 11. Troubleshooting en Windows

### 11.1 Line endings

`.gitattributes` (ilustrativo):

```gitattributes
* text=auto eol=lf
*.{cmd,bat,ps1} text eol=crlf
*.{png,jpg,jpeg,gif,webp,pdf,ico,woff2} binary
*.dump binary
```

Síntoma típico sin esto: `exec /usr/local/bin/docker-entrypoint.sh: no such file or directory` o `$'\r': command not found` en scripts copiados a imágenes. Prettier con `endOfLine: "lf"`; `.editorconfig` `end_of_line = lf`.

### 11.2 File watching y rendimiento (WSL2)

- **Recomendado:** clonar el repo dentro de WSL2 (`\\wsl$\Ubuntu\home\<user>\src\personal-finances`) y abrir con VS Code *Remote - WSL*. Los bind mounts y el watcher (inotify) funcionan nativamente y `pnpm install` es varias veces más rápido que en `/mnt/c` o `D:\`.
- Si el repo vive en `D:\projects\…` (situación actual del owner): Modo A (apps en el host Windows) funciona bien porque no hay bind mounts de código; evitar Modo C. Si el watcher falla en contenedores, `CHOKIDAR_USEPOLLING=1` / `WATCHPACK_POLLING=true` como último recurso (coste CPU).
- Excluir del antivirus (Defender) `node_modules`, `.turbo`, `.next` y la carpeta del repo (acción del owner; afecta a política de seguridad local → decisión suya).
- `.wslconfig`: `memory=8GB`, `processors=4`, `autoMemoryReclaim=gradual`.

### 11.3 Conflictos de puertos

| Puerto | Conflicto habitual | Solución |
|---|---|---|
| 5432 | PostgreSQL instalado en Windows | `HOST_PORT_POSTGRES=5433` en `.env` |
| 3000/3001 | Otro dev server / Grafana local | `HOST_PORT_WEB`, `HOST_PORT_GRAFANA` |
| 8080/8081 | Tomcat, proxies corporativos, IIS Express | `HOST_PORT_API`, `HOST_PORT_KEYCLOAK` (+ actualizar `OIDC_PUBLIC_BASE_URL`/`OIDC_ISSUER`) |
| 9000 | Portainer, PHP-FPM | `HOST_PORT_OBJECT_STORAGE` (+ `OBJECT_STORAGE_PUBLIC_ENDPOINT`) |
| Rangos reservados | Hyper-V/WinNAT reserva rangos dinámicos | `netsh interface ipv4 show excludedportrange protocol=tcp`; elegir puertos fuera del rango |

`pnpm doctor` detecta puertos ocupados con `net.createServer().listen()`.

### 11.4 Otros

- **Keycloak tarda en estar healthy** (60–90 s en frío): normal; `start_period: 60s`.
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

1. **Línea de Node:** ¿arrancar Phase 1 con Node 26 (LTS desde 2026-10-28, EOL abr-2029) o Node 24 (Maintenance desde 2026-10-20, EOL abr-2028)? Propuesta: Node 26 si Next.js/NestJS/dependencias nativas lo soportan en SPIKE-08; si no, 24.
2. **Object storage local:** SeaweedFS (candidato) vs Garage vs RustFS — SPIKE-07. ¿Se acepta actualizar ARCHITECTURE §10 para no nombrar MinIO como primera opción?
3. **`keycloak-db` en ARCHITECTURE §10** aparece como volumen; se propone corregir a "base de datos `keycloak` en `postgres`".
4. **Profile `tools`:** ¿se incorpora (cliente web de BD) o se deja fuera?
5. **Placeholders en el realm import** de Keycloak: confirmar en SPIKE-06 o usar render previo.
6. **Docker Desktop vs alternativas** (licencia de Docker Desktop para uso personal es gratuita; Rancher/Podman no se soportan oficialmente): ¿se exige Docker Desktop?
7. **Ubicación del repo:** ¿mover el repo de `D:\projects` a WSL2 para habilitar Modo C y Dev Containers con buen rendimiento?
8. **Valkey vs Redis** en local: se propone Valkey 8 (licencia BSD) por paridad con ElastiCache for Valkey ([21-cloud-deployment-options.md](21-cloud-deployment-options.md)).
