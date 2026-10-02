# ADR-0001: Registrar las decisiones de arquitectura (ADRs en formato MADR)

- Estado: Aceptado
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md (§5 Lista canónica de ADRs), docs/adr/README.md, ADR-0024, OpenSpec capability `quality/test-traceability`

## Contexto y problema

PFOS es un producto greenfield de larga vida (ledger financiero, multi-moneda, multi-workspace) construido inicialmente por **una sola persona** que actúa como Product Owner, Tech Lead e implementador, con asistencia intensiva de agentes de IA. En ese contexto el riesgo principal no es la falta de decisiones sino su **pérdida**: decisiones tomadas en chats, en la cabeza del owner o implícitas en el código, que luego se revierten por accidente (por ejemplo, "usemos `number` para montos, es más simple") o que un agente de IA reabre en cada sesión por no conocer su justificación.

Necesitamos un mecanismo ligero, versionado junto al código, que registre **qué** se decidió, **por qué**, **qué alternativas se descartaron** y **cómo validaremos** la decisión, y que sea consumible tanto por humanos como por agentes.

`docs/ARCHITECTURE.md` es el resumen canónico de decisiones; los ADRs son el **detalle razonado** de cada una. Hace falta definir la relación entre ambos para que no diverjan.

## Drivers de decisión

- Trazabilidad de decisiones durante años (finanzas personales = datos históricos de décadas).
- Equipo de 1 persona + agentes de IA: el contexto debe vivir en el repositorio, no en la memoria.
- Bajo costo de escritura y mantenimiento (Markdown plano, sin herramientas propietarias).
- Revisable en PRs junto al cambio de código/spec que motiva la decisión.
- Coherencia con Spec Driven Development (OpenSpec, ADR-0024): las specs describen *comportamiento*, los ADRs describen *decisiones estructurales*.

## Opciones consideradas

1. **ADRs en Markdown, formato MADR adaptado, en `docs/adr/`** (versionados en git).
2. Wiki externa (Notion/Confluence) con páginas de decisión.
3. Solo `ARCHITECTURE.md` (documento único sin registros individuales).
4. Design docs RFC-style largos por iniciativa.
5. No documentar formalmente (decisiones implícitas en código y commits).

## Decisión

Se adopta la opción 1: **Architecture Decision Records en formato MADR adaptado**, en español (términos técnicos en inglés), en `docs/adr/NNNN-titulo-kebab.md`, con numeración secuencial de 4 dígitos que **nunca se reutiliza**.

Reglas:

- **`docs/ARCHITECTURE.md` es canónico.** Un ADR formaliza y justifica lo que ARCHITECTURE resume. Si un ADR necesita cambiar una decisión canónica, el mismo PR (o cambio OpenSpec asociado) actualiza ARCHITECTURE.md; nunca se diverge en silencio.
- **Estructura obligatoria:** encabezado (Estado, Fecha, Decisores, Relacionado) + secciones *Contexto y problema, Drivers de decisión, Opciones consideradas, Decisión, Análisis de opciones (pros, contras, costo, complejidad operativa), Consecuencias, Validación, Notas*.
- **Estados:** `Propuesto` → `Aceptado` → (`Deprecado` | `Reemplazado por ADR-NNNN`). También `Rechazado` para propuestas descartadas que conviene conservar.
- **Inmutabilidad:** un ADR `Aceptado` no se reescribe en lo sustancial. Se corrige con un ADR nuevo que lo reemplaza (`Reemplaza: ADR-NNNN`) y el antiguo se marca `Reemplazado por ADR-MMMM`. Se permiten correcciones editoriales y adición de Notas fechadas.
- **Aceptación en Phase 0:** todos los ADRs salvo este nacen `Propuesto`; pasan a `Aceptado` en el DESIGN GATE (`docs/DESIGN-GATE.md`) o tras el spike que los valida (columna Validación).
- **Relación con OpenSpec:** un cambio OpenSpec (`openspec/changes/<id>/design.md`) que tome una decisión estructural DEBE referenciar o crear un ADR. Las specs no contienen decisiones tecnológicas; los ADRs no contienen requisitos de comportamiento.
- **Hechos verificados:** cuando una decisión depende de hechos externos (licencias, versiones, precios), la sección Notas registra el hecho con fecha de verificación; lo no verificado se marca "a verificar en SPIKE-NN".
- El índice vive en `docs/adr/README.md` y se actualiza en el mismo PR que añade o cambia un ADR.

## Análisis de opciones

### 1. ADRs MADR en repo (elegida)
- **Pros:** versionado con el código; revisable en PR; legible por agentes IA; formato conocido en la industria; plantilla fuerza a enumerar alternativas y consecuencias; costo cero.
- **Contras:** disciplina manual; riesgo de desactualización de ARCHITECTURE.md vs ADR.
- **Costo:** nulo (Markdown + git).
- **Complejidad operativa:** muy baja; un check de CI opcional (lint de encabezados/índice).

### 2. Wiki externa
- **Pros:** edición rica, comentarios.
- **Contras:** se desacopla del código; no versiona con el commit; agentes IA no la ven; dependencia de SaaS.
- **Costo:** suscripción potencial. **Complejidad:** media (sincronización manual).

### 3. Solo ARCHITECTURE.md
- **Pros:** un único lugar.
- **Contras:** el documento crece sin control; se pierde el razonamiento y las alternativas; difícil saber cuándo y por qué cambió algo.
- **Costo:** nulo. **Complejidad:** baja inicialmente, alta a medio plazo.

### 4. RFC/design docs largos
- **Pros:** profundidad.
- **Contras:** caros de escribir para un equipo de 1; el estado de la decisión queda enterrado. Los `design.md` de OpenSpec ya cubren el diseño por cambio.
- **Costo:** tiempo alto. **Complejidad:** media.

### 5. Sin documentación formal
- **Pros:** cero esfuerzo inicial.
- **Contras:** decisiones se reabren; agentes IA proponen alternativas ya descartadas; deuda de conocimiento.
- **Costo:** alto diferido. **Complejidad:** n/a.

## Consecuencias

**Positivas**
- Cada decisión tecnológica tiene problema, alternativas, pros/contras, costo, complejidad operativa y validación explícitos.
- Los agentes IA pueden leer `docs/adr/` como contexto antes de proponer cambios.
- El DESIGN GATE tiene un artefacto concreto que aprobar.

**Negativas**
- Overhead de escritura por decisión (~30–60 min).
- Doble mantenimiento ARCHITECTURE.md ↔ ADR.

**Riesgos**
- Divergencia silenciosa entre ARCHITECTURE.md y ADRs. *Mitigación:* regla de "mismo PR"; revisión en checklist de PR.
- ADRs que se quedan en `Propuesto` indefinidamente. *Mitigación:* cada ADR Propuesto declara su spike/criterio de aceptación; revisión al cierre de cada fase.

## Validación

- Existe `docs/adr/README.md` con índice coherente con los archivos (check manual en Phase 0; script de CI opcional en Phase 1 que verifique encabezados obligatorios y que todo ADR aparezca en el índice).
- En el DESIGN GATE, cada ADR está enlazado desde ARCHITECTURE §5 y viceversa.
- Métrica cualitativa: ninguna discusión de diseño en PRs reabre una decisión registrada sin un ADR nuevo que la reemplace.

## Notas

- Formato basado en MADR (Markdown Architectural Decision Records), adaptado: se añade "Análisis de opciones" con costo y complejidad operativa explícitos, y "Validación" para atar cada decisión a un spike, test de arquitectura o métrica.
- Idioma: español para prosa, inglés para términos técnicos (consistente con ARCHITECTURE §12).
