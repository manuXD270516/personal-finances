# SPIKE-08 — Docker Compose en Windows 11 / WSL2

> Código **descartable**. Valida ADR-0011 y ADR-0012 y la propuesta de [docs/19-local-development.md](../../docs/19-local-development.md) con servicios sustitutos (stand-ins). No contiene código de producto.
> Ejecutado el 2026-10-01/02 en la máquina del owner.

## 1. Pregunta

¿La plataforma local propuesta (Compose con profiles, healthchecks, `migrate` one-shot, scripts TypeScript con `tsx`) funciona de forma fiable en la máquina Windows del owner? En concreto: tiempos de arranque, bloqueo ante migración fallida, profiles, puertos configurables, apagado ordenado (SIGTERM / `init`), hot reload desde `D:\` frente a sistema de archivos Linux, line endings y persistencia de volúmenes.

## 2. Entorno

| Elemento | Valor |
|---|---|
| SO | Windows 11 Enterprise 10.0.26200 |
| Docker | Docker Desktop, Engine **29.8.1**, Compose **v5.5.1**, backend WSL2 (kernel 6.6.87.2) |
| Node / pnpm | Node 22.23.1 / pnpm 12.4.2 (host) |
| Shells probados | PowerShell 7.6.6, Git Bash (bash 5.3.15) |
| WSL | Distro `Ubuntu` **sin** integración de Docker Desktop activada |
| git | `core.autocrlf=true` (global) |
| Rango dinámico TCP de Windows | 49152–65535 (16384 puertos); exclusiones Hyper-V: 50000–50059, 50902–51001, 64518–65137 |
| Puertos ya ocupados por otros proyectos | 5432, 5433, 55432, 56379, 6379, 1025, 8025, 9000/9001, 7700, 27017, 18180 |

## 3. Setup

```
SPIKE-08-compose-windows/
├── compose.yaml               # postgres:18, valkey 8, migrate (one-shot), api, worker, seed, otel (stand-in)
├── .env.example               # PF_*_PORT (defaults 618xx del spike)
├── .gitattributes             # eol=lf para .sh/.sql/Dockerfile
├── app/                       # imagen stand-in de finance-api: api.mjs | worker.mjs (comando), healthcheck.mjs
├── migrate/                   # 001_ok.sql, fail.sql (rota a propósito), seed.sql
├── signals/compose.signals.yaml  # matriz PID 1 / SIGTERM / zombies
├── hotreload/                 # imagen con chokidar 4 (watcher.mjs, writer.mjs) + app para node --watch
├── crlf/                      # entrypoint.sh + Dockerfile + run-crlf-experiment.sh
├── scripts/
│   ├── stack.ts               # up|down|reset|logs|ps sobre docker compose (spawn sin shell)
│   ├── measure-startup.ts     # (1)
│   ├── measure-signals.ts     # (5)
│   ├── measure-hotreload.ts   # (6) en contenedor
│   └── measure-hotreload-host.ts # (6) Modo A (node --watch en Windows)
└── results/                   # evidencia cruda
```

Servicios: `postgres` y `redis` (profiles `deps`,`core`); `migrate`, `api`, `worker` (`core`); `seed` (`seed`); `otel` (`observability`, busybox httpd como sustituto de otel-lgtm). `api`/`worker` dependen de `migrate: service_completed_successfully` y de `postgres`/`redis: service_healthy, restart: true`. `/health/ready` del api consulta PG (incluida la tabla de migraciones) y Valkey (`PING`). Imagen app: `node:22-alpine`, `USER node`, `ENTRYPOINT ["node"]` (forma exec), `init: true`, `read_only`, `cap_drop: [ALL]`.

## 4. Comandos

```powershell
pnpm install
pnpm tsx scripts/stack.ts up                       # profile core (default)
pnpm tsx scripts/stack.ts up --profile=deps
pnpm tsx scripts/stack.ts logs api --no-follow --tail=50
pnpm tsx scripts/stack.ts reset --yes              # down -v + up
pnpm tsx scripts/stack.ts down
pnpm tsx scripts/measure-startup.ts --cold-pull --runs=3
pnpm tsx scripts/measure-signals.ts
pnpm tsx scripts/measure-hotreload.ts --iterations=8 --filler=2000
pnpm tsx scripts/measure-hotreload-host.ts
sh crlf/run-crlf-experiment.sh <scratch-dir>        # Git Bash
$env:PF_MIGRATE_FILE='fail.sql'; docker compose --profile core up -d --wait   # (2)
docker compose -p pf-spike-08 down -v              # limpieza final
```

## 5. Mediciones

### 5.1 (1) Arranque `docker compose --profile core up -d --wait` — [startup.json](results/startup.json)

| Escenario | Runs (ms) | Mediana |
|---|---|---|
| Build `--no-cache` de la imagen app (npm install) | 15 758 | **15,8 s** |
| `up` frío con pull de Valkey (61 MB) + volúmenes vacíos | 14 027 | **14,0 s** |
| Frío de volúmenes (imágenes en caché, initdb + migrate) | 6 089 / 6 528 / 7 150 | **6,5 s** |
| Templado: `down` (volúmenes conservados) → `up` | 5 726 / 5 576 / 5 767 | **5,7 s** |
| Templado: `stop` → `up` | 5 076 / 5 262 / 4 971 | **5,1 s** |
| `up` sin cambios (todo corriendo) | 2 363 | 2,4 s |
| `--profile deps` desde cero (solo PG + Valkey) | 4 369 | 4,4 s |

`postgres:18` (650 MB) ya estaba en caché (lo usan otros proyectos; no se borró). Un pull real añade ~1–3 min según la red; sigue muy por debajo del objetivo de ADR-0012 (< 5 min frío, < 90 s en caché). Con el producto real dominarán Keycloak (60–90 s) y el build de las imágenes.

### 5.2 (2) `migrate` falla — [02-migrate-fail.txt](results/02-migrate-fail.txt), [02b](results/02b-migrate-fail-with-stack-running.txt)

| Situación | Resultado |
|---|---|
| Stack bajado, `PF_MIGRATE_FILE=fail.sql up -d --wait` | `migrate` Exited (3); `up` **exit 1** en 3,6 s; `api`/`worker` en estado **Created** (nunca arrancan, `StartedAt=0001-01-01`, sin logs, puerto 61880 cerrado). ✅ |
| Stack ya corriendo + migración nueva rota | `up` exit 1, pero **`api`/`worker` siguen corriendo con la versión anterior** (Compose no los para). |
| Mensajes | Compose imprime además ruido engañoso (`dependency postgres failed to start`) aunque PG está healthy. |
| Atomicidad | `psql -f` aplicó el `CREATE SCHEMA` previo al error: la migración real debe ser transaccional (dbmate lo es por fichero). |

### 5.3 (3) Profiles — [03-profiles.txt](results/03-profiles.txt)

| Comando | Contenedores |
|---|---|
| `--profile deps` | solo `postgres`, `redis` (healthy, puertos 61832/61837 accesibles desde Windows) ✅ |
| `--profile deps --profile observability` | + `otel` ✅ |
| `--profile core` | postgres, redis, migrate (exit 0), api, worker ✅ |
| `--profile seed` solo | **inválido**: `service "seed" depends on undefined service "migrate"` |
| `--profile core --profile seed up -d --wait` | seed inserta, pero `up --wait` devuelve **exit 1** (`container …seed-1 exited (0)`): un one-shot "hoja" del que nadie depende rompe `--wait` aunque salga 0 |
| `docker compose --profile core run --rm seed` | exit 0, propaga el código del seed ✅ |

### 5.4 (4) Puertos de host — [04-08-gitbash-ports.txt](results/04-08-gitbash-ports.txt), [04b](results/04b-port-native-collision.txt)

| Prueba | Resultado |
|---|---|
| `PF_PG_PORT=61932 PF_API_PORT=61942 up` | Publicados en 61932/61942, `/health/ready` OK ✅ |
| `PF_PG_PORT=5432` (default canónico) | `Bind for 127.0.0.1:5432 failed: port is already allocated` → exit 1 |
| `PF_VALKEY_PORT=6379` (default canónico) | `Bind for 0.0.0.0:6379 failed: port is already allocated` → exit 1 |
| Rango 61xxx | Se observó un proceso nativo de otro trabajo escuchando en 127.0.0.1:61980 y un puerto 61985 usado como puerto **efímero** de salida (DNS): 61xxx está dentro del rango dinámico de Windows. |

En esta máquina **colisionan** los defaults canónicos 5432, 6379, 1025, 8025 y 9000/9001 (ARCHITECTURE §10); 3000/8080 son los más habituales de otros dev servers. El fallo es temprano y claro (`--wait` sale 1), pero obliga a editar `.env` en la primera ejecución.

### 5.5 (5) SIGTERM, `stop_grace_period` e `init` — [05-signals.md](results/05-signals.md), [05b](results/05b-main-stack-graceful-stop.txt)

`stop_grace_period: 10s`, drain simulado 1,5 s:

| PID 1 | Handler SIGTERM | ¿Corre el handler? | Exit | Tiempo de `stop` |
|---|---|---|---|---|
| `node api.mjs` (exec, sin init) | sí | sí | 0 | 2,2 s |
| `node api.mjs` (exec, sin init) | **no** | no — PID 1 ignora SIGTERM | **137** (SIGKILL) | **10,8 s** (agota el grace) |
| `docker-init -- node` (`init: true`) | sí | sí | 0 | 2,4 s |
| `docker-init -- node` (`init: true`) | no | no (muere al instante) | 143 | 1,0 s |
| `sh -c "node …; echo"` (wrapper) | sí | **no** — sh no reenvía | 137 | 11,0 s |
| `docker-init -- sh -c "node …"` | sí | **no** — tini señala a sh, node muere sin drenar | 143 | 0,9 s |
| `npm start` | sí | sí (npm 10 reenvía) | 0 | 2,4 s |

Zombies (worker que lanza `sh -c "sleep 0.2 &"` cada 500 ms, ~20 s): **115 zombies sin `init`**, **0 con `init: true`**.
Stack principal (`init: true`): `docker compose stop api worker` → handlers ejecutados, drain 2 s / 3 s, exit 0 ambos, 6,2 s.

### 5.6 (6) Hot reload — [06-hotreload.json](results/06-hotreload.json), [06b](results/06b-hotreload-host.json)

Latencia escritura del fichero → detección (chokidar 4) o proceso reiniciado (`node --watch`). Árbol vigilado: 2 004 ficheros. 8 iteraciones. Reloj Windows↔VM corregido (offset ≤ 2 ms, RTT ≤ 4 ms).

| Ubicación del código | Escritor | Modo | Detectados | p50 | máx | CPU en reposo del watcher |
|---|---|---|---|---|---|---|
| Bind mount `D:\` (9p/drvfs) | Windows | chokidar nativo (inotify) | **0/8** | — | — | 0 % |
| Bind mount `D:\` | Windows | `node --watch` | **0/8** | — | — | 0 % |
| Bind mount `D:\` | Windows | polling 100 ms | 8/8 | 133 ms | 170 ms | **~52 %** (scan inicial 13,5 s) |
| Bind mount `D:\` | Windows | polling 1000 ms | 8/8 | 814 ms | 988 ms | ~20 % |
| ext4 en la VM WSL2 (volumen nombrado) | Linux | chokidar nativo | 8/8 | **0 ms** | 1 ms | 0 % |
| ext4 en la VM WSL2 | Linux | `node --watch` | 8/8 | 258 ms | 266 ms | 0 % |
| ext4 en la VM WSL2 | Linux | polling 100 ms | 8/8 | 67 ms | 94 ms | ~8 % |
| ext4 en la VM WSL2 | Linux | polling 1000 ms | 8/8 | 668 ms | 861 ms | ~1,3 % |
| **Modo A**: `D:\` en el host, sin contenedor | Windows | `node --watch` | 8/8 | **267 ms** | 283 ms | — |

Notas: el bind mount de `D:\` es `9p (aname=drvfs)`: los cambios hechos desde Windows **no generan eventos inotify** en el contenedor. El ~250 ms de `node --watch` es el coste de reinicio del proceso, no de detección. El caso "repo dentro de WSL2" se midió con un volumen nombrado (ext4 en la misma VM, escritor Linux) porque montar `\\wsl.localhost\Ubuntu\…` desde el CLI de Windows falla sin la integración WSL de Docker Desktop (`stat /run/guest-services/distro-services/ubuntu.sock: no such file or directory`); activarla es un ajuste del owner y no se tocó.

### 5.7 (7) Line endings — [07-crlf.txt](results/07-crlf.txt)

Repo de prueba con `core.autocrlf=true` (configuración real del owner), commit de un `entrypoint.sh` en LF y clone:

| Variante | CRLF en el checkout | `ENTRYPOINT ["/entrypoint.sh"]` | `sh /entrypoint.sh` |
|---|---|---|---|
| Sin `.gitattributes` | 4 líneas | `exec /entrypoint.sh: no such file or directory`, exit 255 | `set: line 2: illegal option -`, exit 2 |
| Con `*.sh text eol=lf` | 0 | OK, exit 0 | OK, exit 0 |

Trampa adicional de Git Bash: `docker run … /entrypoint.sh` se reescribe a `C:/Program Files/Git/entrypoint.sh` (conversión de rutas MSYS). Hace falta `MSYS_NO_PATHCONV=1`; los scripts TS con `spawn` no tienen este problema.

### 5.8 (8) Scripts TS cross-platform — [08-09-scripts-powershell.txt](results/08-09-scripts-powershell.txt), [04-08-gitbash-ports.txt](results/04-08-gitbash-ports.txt)

| Shell | `up` | `down` | `logs` | `reset` | `ps` |
|---|---|---|---|---|---|
| PowerShell 7.6 | ✅ 7,4 s | ✅ | ✅ | ✅ (sin TTY y sin `--yes` → se niega, exit 2) | ✅ |
| Git Bash 5.3 | ✅ | ✅ | ✅ | ✅ | ✅ |

`spawn('docker', args, { shell: false })` + `node:path` funciona igual en ambos; las variables `PF_*` pasan por entorno (`$env:X=…` / `X=… cmd`). pnpm 12 **no acepta `pnpm -s`** (ojo en docs/CI).

### 5.9 (9) Persistencia de volúmenes nombrados

`down` → los volúmenes `pf-spike-08_pg-data` y `pf-spike-08_redis-data` permanecen; tras `up` la fila PG (`survives-down`) y la clave Valkey (`survives`) siguen ahí ✅. `reset --yes` (`down -v` + `up`) → volúmenes recreados, tabla vacía (0 filas) y clave ausente ✅. El volumen de PG 18 se monta en `/var/lib/postgresql` (PGDATA `…/18/docker`) y funciona.

## 6. Recomendaciones concretas para docs/19

1. **Puertos (esquema `PF_<SERVICIO>_PORT`)**. Renombrar `HOST_PORT_*` → `PF_*_PORT` (prefijo de producto, evita choques con variables de otras herramientas) y **cambiar los defaults** a un bloque propio por debajo del rango dinámico de Windows (49152–65535) y fuera de las exclusiones Hyper-V: regla mnemónica "2 + puerto canónico":

   | Variable | Default propuesto | Canónico (contenedor) |
   |---|---|---|
   | `PF_PG_PORT` | 25432 | 5432 |
   | `PF_VALKEY_PORT` | 26379 | 6379 |
   | `PF_S3_PORT` / `PF_S3_UI_PORT` | 29000 / 29001 | 8333 / UI |
   | `PF_MAILPIT_UI_PORT` / `PF_SMTP_PORT` | 28025 / 21025 | 8025 / 1025 |
   | `PF_KEYCLOAK_PORT` | 28081 | 8080 |
   | `PF_API_PORT` | 28080 | 8080 |
   | `PF_WEB_PORT` | 23000 | 3000 |
   | `PF_GRAFANA_PORT` / `PF_OTLP_GRPC_PORT` / `PF_OTLP_HTTP_PORT` | 23001 / 24317 / 24318 | 3000 / 4317 / 4318 |
   | `PF_ML_PORT` | 28090 | 8090 |

   Todos libres en esta máquina. Añadir `PF_BIND_ADDR=127.0.0.1` (no exponer a la LAN). Dentro de la red Compose se siguen usando los puertos canónicos. `pnpm doctor` debe comprobar cada `PF_*_PORT` con `net.createServer().listen()` y `netsh … excludedportrange` antes de `stack:up`. `env:init` deriva `.env.host` y las URLs OIDC/S3 públicas de estas variables. **No** usar 61xxx para el producto (rango efímero).
2. **Ubicación del repo**: mantener `D:\projects` con **Modo A** (apps en el host + profile `deps`) como camino principal: `node --watch` en el host recarga en ~270 ms sin polling. **No** soportar bind mounts de código desde `D:\` con watchers nativos (0 % de detección). Modo C (Compose Watch / bind mount en contenedor) y Dev Containers solo con el repo clonado en WSL2 **y** la integración WSL de Docker Desktop activada para la distro (decisión del owner).
3. **Polling**: solo como último recurso en `D:\` y con intervalo ≥ 1000 ms (`CHOKIDAR_USEPOLLING=1`, `CHOKIDAR_INTERVAL=1000`, `WATCHPACK_POLLING=true`); a 100 ms cuesta ~50 % de un core con 2 000 ficheros. Excluir siempre `node_modules`, `dist`, `.next`, `.turbo`.
4. **Compose**: añadir `start_period` en **todo** healthcheck con `start_interval` (el de `redis` en §5 es inválido en Docker 29). Mantener `init: true`, ENTRYPOINT en forma exec y handler SIGTERM: nunca `sh -c`/entrypoint.sh sin `exec`. `stop_grace_period` > drain de la app (validado).
5. **Seed**: `db:seed` debe ejecutar `docker compose --profile core run --rm seed`; no incluir `seed` en un `up --wait` (sale 1). Documentar que `--profile seed` solo es inválido.
6. **Migrate**: `stack:up` debe tratar el exit≠0 como error bloqueante y advertir que, si el stack ya estaba arriba, `api`/`worker` siguen con la versión anterior (sugerir `stack:down` o `restart`). Mostrar `compose logs migrate` automáticamente al fallar.
7. **Scripts**: el patrón `spawn` sin shell es correcto; añadir `--project-directory`, `--yes` obligatorio sin TTY, y no usar `pnpm -s`. Evitar comandos `docker` con rutas absolutas en scripts bash (MSYS path conversion).
8. **Line endings**: el `.gitattributes` de §11.1 es suficiente y necesario (el owner tiene `autocrlf=true`); añadir explícitamente `*.sh`, `*.sql` y `Dockerfile*` con `eol=lf`.

## 7. Riesgos

- **Defaults canónicos colisionan** con otros proyectos del owner: sin el cambio de puertos, el primer `stack:up` falla.
- **Migración rota con stack arriba** deja api/worker corriendo con código anterior; posible confusión en desarrollo.
- **Bind mounts desde `D:\`**: sin eventos de ficheros; polling caro en CPU (batería/ventiladores) y lento en el scan inicial.
- **Integración WSL de Docker Desktop** desactivada en la distro: el flujo "repo en WSL2" no funciona sin un ajuste manual del owner.
- **Medición del caso WSL2** hecha con volumen nombrado (misma clase de FS ext4 en la VM), no con un bind mount real de la distro; el resultado esperado es equivalente pero no se midió directamente.
- Pull en frío de `postgres:18` no medido (imagen compartida en caché).
- Docker Desktop/Compose cambian validaciones entre versiones (p. ej. `start_period`): fijar versión mínima en `pnpm doctor` y en CI.

## 8. Impacto en ADRs / docs

- ADR-0012: se añade "Resultado del spike"; sigue **Propuesto** (acepta el owner).
- ADR-0011: confirma `init: true` + forma exec + handler SIGTERM; `npm start` funciona pero sigue desaconsejado (proceso extra).
- docs/19: §5 (`start_period`, puertos `PF_*`), §6.2 (`.env.example`), §7 (`db:seed` con `run --rm`), §11.2/§11.3 (resultado de hot reload y puertos), §13 pregunta 7 (ubicación del repo) contestada.
- ARCHITECTURE §10: columna "Puerto host (default)" debería reflejar los nuevos defaults o indicar "configurable `PF_*_PORT`".
