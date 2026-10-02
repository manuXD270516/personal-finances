# SPIKE-02 — Acceso a datos: Kysely vs Prisma 7 vs Drizzle (PostgreSQL 18 + dbmate)

> Código **descartable**. Evidencia para ADR-0007 (acceso a datos y migraciones), ADR-0005 (PostgreSQL) y ADR-0023 (multi-tenancy + RLS).
> Ejecutado el 2026-10-01/02 en Windows 11 + Docker Desktop (Engine 29.8.1), Node 22.23.1, pnpm 12.4.2.

## 1. Pregunta

¿Qué herramienta de acceso a datos usar en los adapters `infrastructure`: **Kysely**, **Prisma 7** (driver adapter `pg`) o **Drizzle** (1.0 RC), con migraciones **SQL-first (dbmate)**? En concreto, ¿cuál soporta con naturalidad y sin pérdida:

- transacción por comando con `SET LOCAL app.workspace_id` (RLS, seguro con pool),
- constraint trigger `DEFERRABLE INITIALLY DEFERRED` (zero-sum por moneda) que falla en `COMMIT`,
- `NUMERIC(38,18)` sin pasar por `number`,
- tablas append-only (sin `UPDATE/DELETE` para `pf_app`),
- y una BD cuyo esquema es propiedad de migraciones SQL (no del ORM)?

## 2. Setup

| Pieza | Versión (verificada con `npm view` / imagen, 2026-10-01) | Licencia |
|---|---|---|
| PostgreSQL | imagen `postgres:18` → **18.6** (Debian) | PostgreSQL |
| dbmate | npm `dbmate@2.36.0` (2026-09-19) y imagen `ghcr.io/amacneil/dbmate:2.36.0` | MIT |
| Kysely | `kysely@0.29.6` (2026-09-16) + `kysely-codegen@0.20.0` | MIT / MIT |
| Prisma | `prisma@7.10.0`, `@prisma/client@7.10.0`, `@prisma/adapter-pg@7.10.0` (2026-08-25) | Apache-2.0 |
| Drizzle | `drizzle-orm@1.0.0-rc.4` (2026-06-27), `drizzle-kit@1.0.0-rc.4` | Apache-2.0 / MIT |
| Driver | `pg@8.23.1` | MIT |
| Tests | `vitest@5.0.3`, `decimal.js@10.6.0`, `typescript@7.0.2` | MIT / MIT / Apache-2.0 |

Estado de los dist-tags en npm (relevante para madurez):
- `drizzle-orm` **latest = 0.45.3** (2026-09-21); 1.0 sigue en `rc` = 1.0.0-rc.4 (rc.1 2026-04-30 … rc.4 2026-06-27; sin RC nueva en 3 meses, solo builds de preview con tags `rc5`, `beta`, etc.).
- `prisma` (CLI) **latest = 8.0.0-rc.19** (2026-09-29) mientras `@prisma/client` latest = 7.10.0 → **Prisma 8 está en RC** y `npm i prisma@latest` instala hoy una RC (el propio `prisma generate` sugiere actualizar).
- `kysely` sigue en 0.29.x (6 patches desde mayo 2026).
- Descargas semanales npm (2026-09-24…30): drizzle-orm 29.9M, kysely 20.8M, @prisma/client 20.0M, dbmate 0.28M.

Estructura:

```
compose.yaml                      postgres:18 en 127.0.0.1:61432 (proyecto pf-spike-02) + servicio `migrate` (imagen dbmate, profile)
db/init/00-roles.sql              bootstrap (≈IaC): roles pf_migrator (owner) y pf_app (NOBYPASSRLS), fuera de migraciones
db/migrations/20261001000001_ledger_core.sql   schemas platform/iam/fx/ledger, journal_entry/posting/ledger_account,
                                  constraint triggers diferidos (PF001/PF002), forbid_mutation (PF003), RLS ENABLE+FORCE, grants
src/shared/                       escenario común (USDT→BOB de ARCHITECTURE §4.2, montos extremos), seed como pf_migrator
src/kysely/  repo.ts + db.generated.ts (kysely-codegen)
src/prisma/  repo.ts (+ generated/ con `prisma generate`; prisma/schema.prisma de `prisma db pull`)
src/drizzle/ repo.ts + schema.ts (de `drizzle-kit pull`)
src/probes/type-probes.ts         sondas de type-safety con @ts-expect-error (solo tsc)
test/suite.ts                     MISMA suite Vitest para las 3 herramientas; test/<tool>.test.ts la instancia
evidence/                         salidas crudas (vitest, tsc, bench)
```

Todas las conexiones de los repositorios usan **`pf_app`** (no owner, sin `BYPASSRLS`). La política es la de ADR-0023: `workspace_id = current_setting('app.workspace_id')::uuid` **sin `missing_ok`** (fail-closed), envuelta en `platform.current_workspace_id()`.

## 3. Comandos

```powershell
cd spikes/SPIKE-02-data-access
pnpm install                     # pnpm 12 exige allowBuilds para @prisma/engines, prisma, esbuild (pnpm-workspace.yaml)
pnpm db:up                       # docker compose -p pf-spike-02 up -d --wait postgres
pnpm migrate                     # dbmate (npm) como pf_migrator
pnpm migrate:docker status       # misma migración vista con la imagen ghcr.io/amacneil/dbmate:2.36.0
docker compose -p pf-spike-02 run --rm -e DBMATE_NO_DUMP_SCHEMA=false migrate dump   # schema.sql (pg_dump 18 dentro de la imagen)
pnpm gen:kysely                  # kysely-codegen (config .kysely-codegenrc.json)
pnpm gen:prisma                  # prisma db pull && prisma generate
pnpm gen:drizzle                 # drizzle-kit pull (se copió el schema.ts resultante a src/drizzle/schema.ts)
pnpm typecheck                   # tsc --noEmit (sondas de tipos)
$env:BENCH_N=10000; pnpm test -- --reporter=verbose
pnpm db:down                     # docker compose -p pf-spike-02 down -v
```

## 4. Casos probados (idénticos para las 3 herramientas — `test/suite.ts`)

| # | Caso | Cómo se verifica |
|---|---|---|
| a | Conversión USDT→BOB balanceada (5 postings: −100.000000 USDT, +100.000000 USDT, −690.00 BOB, +685.00 BOB, +5.00 BOB) en **una** transacción que empieza con `set_config('app.workspace_id', ws, true)` | lectura + `SUM(amount)` por moneda = 0 |
| b | Entry desbalanceada (fee 4.00 → BOB suma −1.00) | hook `afterInserts` confirma que **todos los INSERT pasaron**; la promesa de la transacción rechaza con `LEDGER_UNBALANCED_ENTRY` / SQLSTATE `PF001` (⇒ falló en `COMMIT`); luego 0 filas (rollback) |
| c | Round-trip `NUMERIC(38,18)`: `0.000000000000000001`, `99999999999999999999.999999999999999999`, `123456789012345678.123456789012345678` (y sus negativos) | string leído `===` `Decimal(x).toFixed(18)` y `Decimal.eq`; `SUM` = 0 |
| d1 | Repositorio **sin** `WHERE workspace_id` | solo ve filas del workspace del contexto; entry de W2 invisible desde W1 |
| d2 | Query sin contexto en conexión nueva | error `42704 unrecognized configuration parameter "app.workspace_id"` (fail-closed) |
| d3 | Pool `max=1`: tx con `SET LOCAL`, luego query sin contexto en **la misma conexión** | error `22P02 invalid input syntax for type uuid: ""` → no hereda el workspace anterior |
| d4 | 40 transacciones concurrentes (pool=4) alternando W1/W2 | cada una ve `current_setting` = su ws y solo filas de su ws |
| e | `UPDATE` y `DELETE` de un posting como `pf_app` | `42501 permission denied for table posting`; monto intacto |
| bench | N entries × 5 postings, una tx por entry | ms/entry |

## 5. Resultados por herramienta

### 5.1 Correctitud (27/27 tests verdes)

| Caso | Kysely 0.29.6 | Prisma 7.10.0 + adapter-pg | Drizzle 1.0.0-rc.4 |
|---|---|---|---|
| a. tx + SET LOCAL + insert balanceado | ✅ | ✅ (transacción interactiva `$transaction(async tx => …)` + `$queryRaw set_config`) | ✅ |
| b. trigger diferido en COMMIT | ✅ `DatabaseError` de `pg`, `code='PF001'` directo | ✅ pero como **`DriverAdapterError`** crudo (no `PrismaClientKnownRequestError`), código en `cause.originalCode` | ✅ `DrizzleQueryError` con `cause.code='PF001'` |
| c. NUMERIC exacto | ✅ `string` | ✅ `Decimal` (decimal.js interno de Prisma, clase `Decimal2`); exacto con `.toFixed(18)` | ✅ `string` (mode por defecto) |
| d1–d4. RLS / pool / concurrencia | ✅ | ✅ | ✅ |
| e. sin UPDATE/DELETE | ✅ `42501` | ✅ `P2039` con `42501` en el mensaje | ✅ `42501` en `cause` |

### 5.2 Evaluación cualitativa

| Criterio | Kysely + kysely-codegen | Prisma 7 | Drizzle 1.0 RC |
|---|---|---|---|
| **RLS `SET LOCAL` por transacción** | Natural: `db.transaction().execute(trx => sql\`select set_config(…, true)\`.execute(trx))`; `Transaction<DB>` se pasa a varios repos (UoW) | Funciona, pero obliga a **transacción interactiva** en *toda* operación (incl. lecturas); timeouts por defecto 5 s / maxWait 2 s; la UoW debe propagar `Prisma.TransactionClient` | Natural: `db.transaction(tx => tx.execute(sql\`…\`))`; `tx` propagable |
| **Pool safety** | Probada (d3/d4) — la seguridad viene de PG (`SET LOCAL`), no de la herramienta | Igual | Igual |
| **NUMERIC sin float** | Lectura `string` (default de `pg`). Codegen por defecto permite **insertar `number`** (`Numeric = ColumnType<string, number\|string, …>`); se corrigió con `overrides` → `ColumnType<string, string, never>` (además impide `UPDATE` de `amount` a nivel de tipos) | Lectura `Prisma.Decimal` (tipo del ORM que llega al mapper). **Escritura acepta `number`** (control negativo en `evidence/typecheck-prisma-number-control.txt`); no hay forma de prohibirlo por tipos | Lectura/escritura `string`; `number` rechazado por tipos. `UPDATE` de `amount` compila (no expresable) |
| **Columnas `date`** | `--date-parser string` + `pg.types.setTypeParser(1082)` → `'YYYY-MM-DD'` | `@db.Date` ⇒ `DateTime`: se escribe/lee `Date` a medianoche UTC (fricción y riesgo de TZ) | `date` → `string` por defecto ✅ |
| **Type-safety DX** | Muy buena; tipos generados desde la BD real, autocompletado de `'ledger.posting'`; columnas inexistentes = error | Muy buena en el client, pero modelo introspectado con nombres de relación ilegibles (`posting_posting_workspace_id_journal_entry_idTojournal_entry`) que habría que renombrar a mano | Muy buena; schema TS legible tras `pull` |
| **Migraciones SQL-first** | No compite: no tiene modelo; `kysely-codegen` lee la BD migrada por dbmate | `prisma db pull` funciona pero **advierte** RLS y CHECK "not fully supported", **ignora triggers/funciones/grants/FORCE RLS** y representa `INCLUDE (amount)` como columna de índice (si alguien usa `prisma migrate diff`, verá drift falso). Prisma Migrate no se usaría | `drizzle-kit pull` captura CHECK y políticas (`pgPolicy`, `.withRLS`), pero **ignora triggers, funciones, grants, FORCE RLS e `INCLUDE`**, e introspecta `bigint` con `mode:'number'`. Hay que asegurar que nadie corra `drizzle-kit push/generate` |
| **Errores / logs** | `pg` crudo, SQLSTATE directo → mapeo a problem+json trivial | 3 clases distintas según el punto de fallo (`DriverAdapterError` en COMMIT, `P2007`/`P2039` en queries) | `DrizzleQueryError` cuyo `message` incluye **SQL + `params`** (montos, UUIDs) → hay que sanear antes de loguear (datos financieros en logs) |
| **Peso de dependencias** (install aislado `npm i`) | runtime `kysely`+`pg` **3.8 MB / 16 pkgs**; +dev (codegen + dbmate binario 33.6 MB) 49.7 MB | runtime `@prisma/client`+adapter+`pg` **77 MB** (client 72.8 MB); +CLI **320 MB**, 159 pkgs; pnpm 12 exige aprobar *install scripts* | runtime **25.6 MB / 16 pkgs**; +kit 139 MB |
| **Código del repo del spike** | 109 líneas + 75 de tipos generados | 100 líneas + 103 de `schema.prisma` + 11.6k líneas generadas | 99 líneas + 96 de `schema.ts` |
| **Madurez / licencia** | MIT; 0.x pero estable; 2 maintainers | Apache-2.0; 7.x estable pero **8.0 en RC** (otro cambio mayor tras el Rust-free de v7) | Apache-2.0; **1.0 aún RC** (rc.4 de junio, sin rc.5 publicado); latest estable = 0.45.3 |

### 5.3 Rendimiento (indicativo)

Una tx por entry (`BEGIN`, `set_config`, INSERT entry, INSERT 5 postings, `COMMIT` con 5 ejecuciones del trigger diferido), Docker Desktop en Windows:

| Corrida | Kysely | Prisma | Drizzle |
|---|---|---|---|
| Suite completa, 1 000 entries | 8.27 ms | 9.94 ms | 7.65 ms |
| Suite completa, 10 000 entries | 14.11 ms | 9.76 ms | 6.51 ms |
| Aislada, 5 000 entries (orden kysely→drizzle→prisma) | 7.59 ms | 6.71 ms | 6.86 ms |

La varianza entre corridas (7.6↔14.1 ms para la misma herramienta) es mayor que la diferencia entre herramientas: el costo está dominado por los roundtrips a PG/Docker y el trigger, **no** por la capa de acceso. 10⁴ entries (5·10⁴ postings) se insertan en 65–141 s en todas; no es criterio de decisión. *No medido:* overhead de RLS con/sin política (ADR-0023 pide < 10 %) — queda para la implementación con `EXPLAIN ANALYZE`.

### 5.4 dbmate

- `dbmate up` (npm, binario Windows) aplicó la migración en 67 ms; `--wait` espera a la BD. La imagen `ghcr.io/amacneil/dbmate:2.36.0` ve el mismo estado (`status`: Applied 1).
- **Hallazgo:** el paquete npm en Windows no puede escribir `schema.sql` (`exec: "pg_dump": executable file not found in %PATH%`); la imagen sí trae `pg_dump 18.6`. → Usar la imagen (o el contenedor `migrate` del Compose) para `dump`, o `DBMATE_NO_DUMP_SCHEMA=true` localmente.
- Constraint triggers, políticas, `FORCE RLS`, grants y funciones se expresan y revisan como SQL plano; el `schema.sql` volcado los contiene todos.

## 6. Evidencia (extracto de `evidence/vitest-run.txt`, `BENCH_N=10000`)

```
[kysely] (b) error en COMMIT: DatabaseError(code=PF001): LEDGER_UNBALANCED_ENTRY: entry 4d0ec2dc-… currency BOB sum -1.000000000000000000
[kysely] (c) tipo runtime de amount=string; leído=0.000000000000000001 | 99999999999999999999.999999999999999999 | 123456789012345678.123456789012345678
[kysely] (d2) sin contexto, conexión nueva: DatabaseError(code=42704): unrecognized configuration parameter "app.workspace_id"
[kysely] (d3) misma conexión, sin contexto tras tx previa: DatabaseError(code=22P02): invalid input syntax for type uuid: ""
[kysely] (d4) 40/40 transacciones vieron solo su workspace
[kysely] (e) UPDATE: DatabaseError(code=42501): permission denied for table posting
[prisma] (b) error en COMMIT: DriverAdapterError(code=undefined, cause=Object(code=PF001)): LEDGER_UNBALANCED_ENTRY: entry 272e3890-… currency BOB sum -1.000000000000000000
[prisma] (c) tipo runtime de amount=Decimal2; leído=0.000000000000000001 | 99999999999999999999.999999999999999999 | 123456789012345678.123456789012345678
[prisma] (d2) sin contexto, conexión nueva: PrismaClientKnownRequestError(code=P2039): Database error. Code: `42704`. …
[prisma] (d3) misma conexión, sin contexto tras tx previa: PrismaClientKnownRequestError(code=P2007): Invalid input value: invalid input syntax for type uuid: ""
[prisma] (e) UPDATE: PrismaClientKnownRequestError(code=P2039): Database error. Code: `42501`. Message: `permission denied for table posting`
[drizzle] (b) error en COMMIT: DrizzleQueryError(code=undefined, cause=DatabaseError(code=PF001)): …
[drizzle] (c) tipo runtime de amount=string; leído=0.000000000000000001 | 99999999999999999999.999999999999999999 | 123456789012345678.123456789012345678
[drizzle] (e) UPDATE: DrizzleQueryError(code=undefined, cause=DatabaseError(code=42501)): params: 999.00,4a4e91a1-…
 Test Files  3 passed (3)
      Tests  27 passed (27)
```

`pnpm typecheck` → `tsc exit=0` (`evidence/typecheck.txt`): todas las `@ts-expect-error` de Kysely (number en `amount`, `UPDATE` de `amount`, columna inexistente) y Drizzle (number en `amount`) se cumplen; el control negativo de Prisma confirma que `amount: 685.1` **compila** (`TS2578 Unused '@ts-expect-error'`).

## 7. Recomendación

**Confirmar ADR-0007: Kysely + migraciones SQL-first con dbmate.** Cumple los criterios 1–5 del ADR:

1. `SET LOCAL` por transacción y aislamiento verificado (d1–d4), incluida reutilización de conexión del pool.
2. `NUMERIC(38,18)` exacto como `string`, sin tipo del ORM en el mapper.
3. Trigger diferido falla en `COMMIT` con SQLSTATE `PF001` accesible directamente.
4. Mapping a agregado explícito; los tipos generados no salen de `infrastructure`.
5. No tiene modelo propio: la BD migrada por dbmate es la única fuente de verdad; menor huella (3.8 MB runtime).

Ninguna alternativa cumple "todo con menos código **y** sin filtrar su modelo": las tres necesitan ~100 líneas de repo; Prisma filtra `Prisma.Decimal`/`Date` y un modelo introspectado paralelo, y acepta `number` en dinero; Drizzle es técnicamente correcto y ligero, pero 1.0 sigue en RC, su schema TS es un segundo modelo que su kit podría intentar "sincronizar", y sus errores incluyen parámetros. **Drizzle queda como plan B** si Kysely se estancara (cambio barato: mismos patrones de tx/`sql`).

Condiciones de adopción de Kysely:
- `kysely-codegen` con `dateParser: "string"` y **override de columnas monetarias a `ColumnType<string, string, never>`** (por defecto acepta `number`), más `pg.types.setTypeParser(1082, v => v)`.
- Helper UoW único que hace `set_config('app.workspace_id', $1, true)`; nunca `SET` de sesión.
- dbmate: imagen del contenedor `migrate` para `up`/`dump` (el npm en Windows no trae `pg_dump`).

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Kysely 0.x (breaking changes) | Pin exacto + Renovate con revisión; uso confinado a `infrastructure` |
| Codegen por defecto admite `number` en NUMERIC | Override obligatorio + architecture test que falle si un `Numeric` acepta `number` |
| Desincronía tipos ↔ BD | `kysely-codegen` en CI contra BD migrada (Testcontainers), diff ≠ ∅ → falla |
| Fail-closed produce dos errores distintos (`42704` en conexión nueva, `22P02` en conexión reutilizada) | Mapear ambos a "contexto de tenant ausente" (500 interno + alerta), no a 400 |
| Política sin `missing_ok` vs helper de docs/08 con `missing_ok=true` + `NULLIF` (ver §9) | Decidir una sola variante |
| Benchmark ruidoso en Docker/Windows | Medir de nuevo en CI Linux; no usar para decidir |
| RLS overhead no medido | Medirlo al implementar `ledger` (EXPLAIN ANALYZE con/sin política) |

## 9. Impacto en ADRs y docs

- **ADR-0007:** se mantiene la decisión (Kysely + dbmate); añadir sección "Resultado del spike" (hecho). Nuevos datos de mercado: Prisma **8.0 en RC** (`prisma@latest` = 8.0.0-rc.19) y Drizzle 1.0 sigue en rc.4 (fecha real de rc.4 en npm: 2026-06-27, el ADR dice 06-29); dbmate 2.36.0 MIT activo (resuelve el "a verificar"). Añadir a "Detalles" el override de `Numeric` y `dateParser: string`.
- **ADR-0005:** sin cambios de decisión. Confirmado sobre `postgres:18` (18.6): constraint triggers diferidos, RLS ENABLE+FORCE y NUMERIC(38,18) se comportan como se describe. Nota operativa: la imagen PG 18 usa `PGDATA=/var/lib/postgresql/18/docker`; el volumen debe montarse en `/var/lib/postgresql` (ya refleja `compose.yaml`).
- **ADR-0023:** validado: repo sin filtro devuelve solo filas del contexto; sin contexto falla; sin fuga entre transacciones del pool ni en concurrencia. Pendiente: benchmark con/sin RLS. Añadir que, tras un `SET LOCAL` previo en la misma conexión, `current_setting` devuelve `''` (no error de "unrecognized") y el fail-closed depende del cast `::uuid`.
- **docs/08-data-model.md §1.4 (inconsistencia detectada, no editada):** el helper `platform.current_workspace_id()` usa `current_setting('app.workspace_id', true)` + `NULLIF(…,'')` → **sin contexto devuelve NULL y las queries devuelven 0 filas en silencio**, mientras ADR-0023 exige fail-closed "sin `missing_ok` → la query falla" y su validación pide "sin contexto establecido la query falla". El spike implementó la variante de ADR-0023. Recomendación: alinear docs/08 (quitar `missing_ok`/`NULLIF`, o lanzar excepción explícita si es NULL).
- **docs/08 §10.1 / 09 §13:** el DDL de `ledger` corre tal cual (subconjunto probado). Nota: `INCLUDE (amount)` del índice `posting_balance_ix` no sobrevive a la introspección de Prisma/Drizzle — otra razón para no dejar que un ORM gestione DDL.
- **docs/19/ADR-0012 (local):** pnpm 12 bloquea *install scripts* por defecto (`ERR_PNPM_IGNORED_BUILDS`); con Kysely no hace falta aprobar ninguno para la capa de datos (Prisma sí: `@prisma/engines`, `prisma`).

## 10. Limpieza

`docker compose -p pf-spike-02 down -v` ejecutado al finalizar (contenedor, volumen `pf-spike-02_pgdata` y red del proyecto). No se tocaron otros contenedores.
