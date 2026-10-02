# ADR-0012: Entorno de desarrollo local — Docker Compose con profiles y scripts cross-platform

- Estado: Aceptado (2026-10-02, tras SPIKE-08, con enmienda; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §10; docs/19-local-development.md; docs/29-seed-datasets.md; ADR-0005, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0018, ADR-0020; OpenSpec capability `platform/local-environment`; SPIKE-08

## Contexto y problema

El owner desarrolla en **Windows** (con Docker Desktop/WSL2 disponible). El sistema depende de PostgreSQL, Redis/Valkey, object storage S3, Keycloak, Mailpit, y opcionalmente observabilidad y ML. Necesitamos:

- levantar **todo el producto** con un comando (demo, E2E, validación de imágenes);
- levantar **solo dependencias** para correr `api`/`web` en el host con hot reload;
- seeds reproducibles (minimal/demo/large), reset, backup/restore local;
- scripts que funcionen en PowerShell, cmd, Git Bash, WSL, macOS y Linux;
- configuración 12-factor sin secretos en git.

## Drivers de decisión

- Experiencia en Windows de primera clase.
- Un comando para empezar (`pnpm stack:up`).
- Paridad con producción (mismas imágenes, mismos hostnames de servicio por env).
- Rápido ciclo de feedback (hot reload).
- Bajo consumo de recursos con perfiles selectivos.

## Opciones consideradas

1. **Docker Compose con profiles + scripts TypeScript (tsx) vía pnpm** (elegida).
2. Compose + Makefile / scripts bash.
3. Dev Containers (VS Code) como entorno obligatorio.
4. Kubernetes local (kind/minikube + Tilt/Skaffold).
5. Instalaciones nativas en el host (PG, Redis, etc.).
6. Nix / devbox.

## Decisión

- **Docker Compose** en `deploy/compose/compose.yaml` (+ overrides) con los servicios canónicos de ARCHITECTURE §10: `postgres`, `redis` (Valkey), `object-storage`, `mailpit`, `keycloak`, `migrate`, `finance-api`, `finance-worker`, `finance-web`, `seed`, `otel-lgtm`, `ml-forecasting`.
- **Profiles:** `deps` (solo dependencias), `core` (producto completo), `seed`, `observability`, `ml`.
- **Healthchecks** en todos los servicios con `depends_on: condition: service_healthy`; `migrate` como one-shot (`service_completed_successfully`) antes de `finance-api`/`finance-worker`. `finance-api` healthy solo si `/health/ready` OK.
- **Volúmenes nombrados:** `pg-data`, `object-storage-data`, `redis-data` (opcional), BD de Keycloak dentro de PG.
- **Scripts cross-platform** en `scripts/` escritos en **TypeScript ejecutado con tsx**, expuestos como scripts pnpm: `stack:up`, `stack:down`, `stack:restart`, `stack:logs`, `stack:reset`, `db:migrate`, `db:seed -- --profile=minimal|demo|large`, `test`, `test:integration`, `backup:local`, `restore:local`. **Prohibidos scripts solo-bash** (o PowerShell-only) como interfaz principal.
- Config vía `.env` (copiado de `.env.example`, sin secretos reales); sin `localhost` hardcodeado: los servicios se referencian por hostname de Compose; el modo host usa variables con defaults `localhost`.
- Puertos de host configurables por env para evitar colisiones.
- **Repo en `D:` (NTFS)**; modo de desarrollo principal: dependencias en contenedores (`deps`) + apps en el host Windows con `node --watch` (decisión del owner tras SPIKE-08). El modo contenedor completo (`core`) usa las mismas imágenes que CI/staging/prod. Estrategia completa en [19-local-development.md §Estrategia de dockerización y parametrización](../19-local-development.md).

## Análisis de opciones

### 1. Compose + profiles + scripts TS (elegida)
- **Pros:** estándar, incluido en Docker Desktop; profiles cubren deps-only vs full; scripts TS corren igual en cualquier SO con Node; mismo lenguaje que el proyecto; testables.
- **Contras:** Docker Desktop requiere licencia de pago en empresas grandes (no aplica a uso personal; alternativas: Rancher Desktop, Podman con compose); rendimiento de bind mounts en Windows.
- **Costo:** 0 para uso personal. **Complejidad operativa:** baja.

### 2. Compose + Makefile/bash
- **Pros:** habitual en Linux/macOS.
- **Contras:** `make` y bash no están por defecto en Windows; escapes y paths distintos → fricción diaria para el owner.
- **Complejidad:** baja en Unix, alta en Windows. Descartada como interfaz principal.

### 3. Dev Containers obligatorios
- **Pros:** entorno reproducible completo, incluido toolchain.
- **Contras:** ata al editor; docker-in-docker para Compose; overhead de recursos; el owner pierde herramientas nativas. Se puede ofrecer como **opcional** más adelante.
- **Complejidad:** media.

### 4. Kubernetes local (kind + Tilt)
- **Pros:** paridad con un hipotético K8s en producción.
- **Contras:** K8s rechazado en cloud (ADR-0013); consumo de recursos y complejidad sin beneficio.
- **Complejidad:** alta. Descartada.

### 5. Instalaciones nativas
- **Pros:** máximo rendimiento.
- **Contras:** versiones divergentes, Keycloak/Valkey en Windows nativo poco práctico, contamina el host.
- Descartada.

### 6. Nix / devbox
- **Pros:** reproducibilidad del toolchain.
- **Contras:** soporte Windows solo vía WSL; curva de aprendizaje.
- Descartada por ahora.

## Consecuencias

**Positivas**
- `pnpm stack:up` levanta el producto completo en cualquier SO.
- El perfil `deps` permite desarrollo con hot reload y depuración nativa en el host.
- E2E en CI reutilizan el mismo Compose.

**Negativas**
- Consumo de RAM con `core` + Keycloak + observabilidad (~4–6 GB estimados).
- Mantener scripts TS propios en lugar de usar herramientas existentes.

**Riesgos**
- Hot reload lento por FS de Windows. *Mitigación:* SPIKE-08 mide; alternativa: repo en WSL2 o polling configurado.
- Line endings (CRLF) rompen scripts en contenedores. *Mitigación:* `.gitattributes` con `eol=lf` para `*.sh`, `*.sql`, Dockerfiles.

## Validación

- **SPIKE-08 (1 d):** en la máquina Windows del owner: `stack:up --profile core` desde cero < 5 min (con imágenes en cache < 90 s), healthchecks verdes, hot reload de `api` < 3 s con perfil `deps`, comparación NTFS vs WSL2 FS.
- CI ejecuta `stack:up` (perfil core) + smoke E2E en Linux (ADR-0015).
- Test de los scripts en Windows y Linux (matriz de CI con `windows-latest` para los scripts TS sin Docker).

## Notas

- Comandos y servicios son canónicos (ARCHITECTURE §10); renombrarlos requiere actualizar ARCHITECTURE.md.
- Valkey preferido sobre Redis por licencia (ver Notas de ADR-0008).

## Resultado del spike (SPIKE-08, 2026-10-01)

Evidencia: [spikes/SPIKE-08-compose-windows](../../spikes/SPIKE-08-compose-windows/README.md). Windows 11, Docker Desktop (Engine 29.8.1, Compose v5.5.1, WSL2), Node 22, pnpm 12; servicios sustitutos (postgres:18, valkey 8, migrate one-shot, api/worker Node dummy).

- **Arranque `--profile core up -d --wait`**: frío con pull de Valkey 14,0 s (+15,8 s de build sin caché); frío de volúmenes 6,5 s; templado 5,1–5,7 s; `deps` 4,4 s. Cumple los objetivos (< 5 min / < 90 s); el coste real lo marcarán Keycloak y el build de imágenes.
- **`migrate` fallido**: `up` sale 1 y `api`/`worker` quedan en *Created* (nunca arrancan). Si el stack ya estaba arriba, siguen corriendo con la versión anterior.
- **Profiles**: `deps` arranca solo dependencias. `seed` dentro de `up --wait` hace que salga 1 aunque el seed termine con 0 → `db:seed` = `compose --profile core run --rm seed`.
- **Puertos**: los defaults canónicos (5432, 6379, 1025/8025, 9000/9001) **colisionan** con otros proyectos del owner. Se propone `PF_<SERVICIO>_PORT` con defaults "2 + puerto canónico" (25432, 26379, 29000, 28080, 23000…) y `PF_BIND_ADDR=127.0.0.1`, fuera del rango dinámico de Windows (49152–65535), y que `pnpm doctor` compruebe los puertos.
- **Señales**: con `init: true` + ENTRYPOINT exec + handler, SIGTERM drena y sale 0. Node como PID 1 sin handler agota el grace (exit 137); los wrappers `sh -c` nunca ejecutan el handler. Sin init: 115 zombies en ~20 s; con init: 0.
- **Hot reload**: bind mount desde `D:\` (9p) → inotify **no funciona** (0/8, también `node --watch`); polling 100 ms = 133 ms pero ~52 % de CPU; 1000 ms = 814 ms / ~20 % CPU. En ext4 de la VM WSL2: nativo 0–1 ms. **Modo A** (`node --watch` en el host, `D:\`): 267 ms.
- **CRLF**: con `core.autocrlf=true` (configuración del owner) y sin `.gitattributes`, `entrypoint.sh` falla (`exec … no such file or directory`); con `*.sh text eol=lf` funciona.
- **Scripts TS** (`tsx scripts/stack.ts up|down|reset|logs|ps`): funcionan igual en PowerShell 7 y Git Bash. Git Bash reescribe rutas absolutas en comandos `docker` (MSYS), lo que refuerza que no haya scripts bash.
- **Volúmenes nombrados**: los datos de PG/Valkey sobreviven a `down` → `up`; `reset` (`down -v`) los elimina.

**Recomendación**: mantener la decisión. Ajustes: (1) puertos `PF_*_PORT` con nuevos defaults; (2) repo en `D:\` con **Modo A** como camino principal; Modo C/Dev Containers solo con el repo en WSL2 y la integración WSL de Docker Desktop activada (decisión del owner); polling solo como último recurso (≥ 1000 ms); (3) `start_period` obligatorio cuando hay `start_interval` (el compose ilustrativo de docs/19 §5 es inválido en Docker 29); (4) `db:seed` vía `run --rm`; (5) `.gitattributes` con `eol=lf` para `*.sh`, `*.sql` y `Dockerfile*`. El estado sigue en *Propuesto* hasta que lo acepte el owner.

## Enmienda de aceptación (2026-10-02)

El owner eligió repo en `D:` con apps en Windows **con una estrategia clara de dockerización y parametrización desde el inicio**: un único contrato de configuración (variables de entorno validadas al arrancar) compartido por el modo host y el modo contenedor; puertos de host `PF_<SVC>_PORT` con defaults "2 + canónico" en `127.0.0.1`; imágenes idénticas entre local-contenedor, CI, staging y producción. Detalle en docs/19.
