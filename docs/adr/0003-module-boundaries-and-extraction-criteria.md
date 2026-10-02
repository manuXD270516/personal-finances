# ADR-0003: Fronteras de módulos y criterios de extracción a servicio

- Estado: Aceptado (2026-10-02, tras SPIKE-04; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §2, §3, §6, §7; docs/05-bounded-contexts.md; docs/06-context-map.md; docs/08-data-model.md; ADR-0002, ADR-0008, ADR-0017, ADR-0018, ADR-0023; SPIKE-04

## Contexto y problema

ADR-0002 elige un Modular Monolith. Un modular monolith solo es valioso si sus fronteras son **reales y verificables**: si los módulos comparten tablas, se llaman por internals o comparten transacciones arbitrariamente, el sistema degenera en un monolito en capas y la promesa de "extraer un contexto a servicio sin reescribir el dominio" es falsa.

Debemos definir: (1) qué es la frontera de un módulo (código, datos, eventos), (2) qué formas de comunicación están permitidas, (3) cómo se verifica automáticamente, y (4) bajo qué criterios objetivos se extraería un contexto a un servicio independiente.

## Drivers de decisión

- Verificabilidad automática (no depender de revisión humana).
- Permitir transacciones locales donde una invariante financiera lo exige.
- Extracción futura sin reescritura del dominio.
- Bajo costo de implementación con el tooling elegido (pnpm workspaces, TypeScript, dependency-cruiser).
- Evitar extracciones prematuras motivadas por moda.

## Opciones consideradas

**Para las fronteras de código:**
1. Paquete pnpm por contexto con `exports` restringido a `contracts` + dependency-cruiser (elegida).
2. Carpetas dentro de una única app NestJS con convención (sin enforcement).
3. Nx module boundaries con tags (`@nx/enforce-module-boundaries`).

**Para las fronteras de datos:**
A. Schema PostgreSQL por contexto, sin FKs cross-schema (elegida).
B. Schema único compartido con prefijos de tabla.
C. Base de datos por contexto.

**Para la comunicación:**
- i. Síncrona in-process vía `contracts` (application services públicos) + asíncrona vía outbox (elegida).
- ii. Solo eventos (todo asíncrono).
- iii. Llamadas directas a repositorios ajenos.

## Decisión

### Frontera de código
- Cada contexto es un paquete `@pf/<ctx>` en `packages/contexts/<ctx>/src/{domain,application,infrastructure,interface,contracts}`.
- `package.json#exports` expone **solo** `./contracts` (y el módulo Nest de composición para el composition root). Importar `@pf/ledger/src/domain/...` desde otro contexto es imposible a nivel de resolución de módulos.
- dependency-cruiser (CI bloqueante) refuerza: reglas de capas (ARCHITECTURE §6), prohibición de importar internals ajenos, prohibición de ciclos entre contextos.

### Frontera de datos
- Un **schema PG por contexto** (`iam`, `accounts`, `ledger`, `txn`, …, `platform`). Cada contexto solo lee/escribe su schema; su rol de BD lógico puede restringirse en el futuro.
- **Sin FKs cross-schema**, excepto `workspace_id → iam.workspace` y las referencias al catálogo compartido `fx.currency(code)` (ARCHITECTURE §2; docs/08-data-model.md). Referencias cruzadas = ID + validación en application layer.
- **Lecturas cruzadas** para pantallas compuestas: Reporting mantiene **read models propios** alimentados por eventos; no hace JOIN sobre schemas ajenos en código de producción (excepción documentada: queries de reconstrucción/backfill ejecutadas por scripts de mantenimiento).

### Comunicación permitida

| Tipo | Cuándo | Mecanismo |
|---|---|---|
| Síncrona, misma transacción | Solo invariante que lo exige: `Transactions → Ledger` (`LedgerPostingPort`), `Debt/Goals/Commitments → Transactions`, cualquier comando → `Audit` | Application service público en `contracts`, Unit of Work compartida (`@pf/platform`) |
| Síncrona, query | Validar existencia/estado de un ID ajeno | Query pública en `contracts` |
| Asíncrona | Proyecciones, notificaciones, reglas, thresholds | Evento de dominio vía outbox (ADR-0008) |
| Prohibida | Acceso a repositorios, entidades o tablas de otro contexto | — |

La dirección de dependencias entre contextos forma un **DAG** documentado en `docs/06-context-map.md` (context map). Ciclos prohibidos; si A necesita reaccionar a B y B depende de A, se usa evento.

### Criterios de extracción a servicio
Un contexto **se considera** para extracción solo si se cumplen **al menos dos** de:
1. **Carga divergente**: requiere escalar de forma independiente (p. ej. > 5× CPU/memoria del resto, o picos que degradan p95 del core).
2. **Runtime/tecnología distinta** necesaria (p. ej. Python para ML → ya aplicado en ADR-0017).
3. **Ciclo de despliegue distinto**: cambios frecuentes que obligan a redeployar el core con riesgo.
4. **Equipo dedicado** (> 1 persona trabajando en él de forma estable).
5. **Aislamiento de seguridad/compliance** (p. ej. credenciales de banking providers, scraping, datos de terceros).
6. **Aislamiento de fallos**: su fallo derriba el core y no se puede mitigar in-process.

Y **ninguno** de estos bloqueantes:
- Participa en una transacción síncrona con invariante financiera (Ledger, Transactions → nunca candidatos mientras rija el modelo actual).
- No existe todavía un contrato estable (OpenAPI/JSON Schema de eventos) con tests de contrato.

Candidatos naturales (por orden): `FORECAST` (ya separado), `IMPORTS/banking-providers`, `NOTIFY`, `DOCUMENTS` (procesamiento/OCR), `ASSISTANT`. **No** candidatos: `LEDGER`, `TRANSACTIONS`, `ACCOUNTS`, `AUDIT`.

Procedimiento: ADR nuevo con evidencia (métricas), cambio OpenSpec con impacto en APIs/eventos, strangler (el módulo in-process se convierte en un adapter que llama al servicio).

## Análisis de opciones

### Código: paquete + exports + dependency-cruiser (elegida)
- **Pros:** enforcement en dos niveles (resolución de módulos y lint); agnóstico a framework; funciona con Turborepo (ADR-0018).
- **Contras:** reglas de dependency-cruiser requieren mantenimiento; más `package.json` que mantener.
- **Costo:** nulo. **Complejidad operativa:** baja.

### Código: carpetas + convención
- **Pros:** cero setup. **Contras:** sin enforcement → erosión garantizada. **Costo:** nulo. **Complejidad:** baja, riesgo alto.

### Código: Nx module boundaries
- **Pros:** tags y reglas integradas, grafo visual. **Contras:** acopla a Nx (descartado en ADR-0018); mismo resultado alcanzable con dependency-cruiser. **Costo:** nulo. **Complejidad:** media.

### Datos: schema por contexto (elegida)
- **Pros:** propiedad clara; permite permisos por schema; extracción = mover schema; migraciones agrupables por contexto.
- **Contras:** sin FKs cross-schema → integridad referencial cruzada en aplicación; JOINs cruzados desaconsejados.
- **Costo:** nulo. **Complejidad:** baja.

### Datos: schema único con prefijos
- **Pros:** JOINs y FKs triviales. **Contras:** propiedad difusa; acoplamiento por SQL; extracción costosa. **Complejidad:** baja, deuda alta.

### Datos: base por contexto
- **Pros:** aislamiento máximo. **Contras:** pierde transacciones locales Transactions↔Ledger↔Audit; 18 pools; costo cloud. **Complejidad:** alta.

### Comunicación: sync vía contracts + async outbox (elegida) vs solo eventos vs repositorios ajenos
- Solo eventos rompe la atomicidad transacción↔journal↔audit (requeriría sagas). Repositorios ajenos destruyen las fronteras. La opción elegida limita la sincronía a las invariantes y deja todo lo demás eventual.

## Consecuencias

**Positivas**
- Fronteras verificadas en CI; extracción realista y con criterios objetivos.
- Reporting desacoplado mediante read models.

**Negativas**
- Más eventos y read models que en un monolito tradicional; consistencia eventual en vistas compuestas (segundos).
- Validación de referencias cruzadas en código (riesgo de IDs huérfanos). *Mitigación:* soft-archive (no delete) de catálogos referenciados (ARCHITECTURE §9).

**Riesgos**
- Excepciones a la regla de FKs que se acumulan. *Mitigación:* lista cerrada en este ADR; test de arquitectura sobre `information_schema.referential_constraints`.
- Ciclos de dependencia introducidos por contracts. *Mitigación:* dependency-cruiser `no-circular` entre paquetes.

## Validación

- SPIKE-04: violación intencional (import de internals, ciclo) → CI rojo.
- Test de arquitectura SQL: las únicas FKs cross-schema son las listadas.
- Revisión semestral del context map: ¿algún contexto cumple ≥ 2 criterios de extracción? Registrar resultado en Notas de este ADR.

## Notas

- La Unit of Work compartida (ADR-0007) es el mecanismo que permite que `Transactions → Ledger → Audit` ocurra en un solo `COMMIT` aun estando en paquetes separados.

## Resultado del spike (SPIKE-04, 2026-10-01)

Evidencia: [`spikes/SPIKE-04-modular-monolith/README.md`](../../spikes/SPIKE-04-modular-monolith/README.md) y `evidence/arch-prove.txt`.

- **Frontera de código en tres niveles** frente a `import '@pf/ledger/src/domain/…'`: Node `ERR_PACKAGE_PATH_NOT_EXPORTED`, TypeScript `TS2307` y dependency-cruiser `not-to-unresolvable`. `exports` expone solo `./contracts` y `./nest` (este último reservado al composition root), con la condición custom `@pf/source` para que TS/Vitest/dependency-cruiser lean fuentes sin build.
- **Reglas (docs/16 §5.17) verificadas con fixtures:** `domain-no-infra`, `domain-no-framework`, `domain-only-shared-kernel`, `application-no-infra`, `no-cross-context-internals` (bypass por ruta relativa), `no-circular` (ciclo entre contracts de dos contextos), `shared-kernel-pure` y la nueva `composition-root-only-public-entrypoints`: todas fallan (exit ≠ 0) con su fixture y pasan sin él (`pnpm arch:prove`).
- **Comunicación síncrona:** Accounts define su puerto `LedgerPostingPort`; solo su adapter de infrastructure importa `@pf/ledger/contracts`. `AccountsModule.register({ ledger })` deja al composition root decidir el proveedor → la extracción futura se reduce a cambiar el adapter.
- **Lecciones:** no excluir `node_modules` en dependency-cruiser (silencia reglas de framework); exigir un fixture por regla en CI. eslint-plugin-boundaries 7 cubre las reglas de capas (con `checkAllOrigins` y plantillas de captura) pero **no detecta ciclos**: queda como feedback opcional en IDE; dependency-cruiser sigue siendo el gate.
- **Recomendación:** aceptar; incorporar las reglas extra y el requisito de fixtures a docs/16 §5.17.
