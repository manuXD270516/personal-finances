# ADR-0017: Separación de ML/Forecasting — servicio Python independiente (Phase 8), fuera del camino crítico

- Estado: Propuesto
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §2, §3 (FORECAST), §5, §10; docs/15-ml-architecture.md; ADR-0002, ADR-0003, ADR-0008, ADR-0011, ADR-0022; OpenSpec capability `forecast/expense-forecasting`

## Contexto y problema

En Phase 8, PFOS ofrecerá forecasting estadístico: proyección de gastos por categoría, saldo esperado a fin de mes, detección de anomalías y estacionalidad de compromisos. Esto requiere librerías de series temporales y ML cuyo ecosistema maduro está en Python (statsmodels, scikit-learn, Prophet, Polars). Al mismo tiempo, el producto debe ser **completamente útil sin ML** (ARCHITECTURE §1), y el core financiero no puede depender de la disponibilidad o latencia de un modelo.

Hay que decidir dónde vive el cómputo de ML y cómo se integra.

## Drivers de decisión

- Calidad y disponibilidad de librerías de forecasting.
- Aislamiento: fallos/latencia del ML no afectan al core.
- Costo (no pagar cómputo ML permanente sin uso).
- Complejidad operativa (un runtime más).
- Reproducibilidad de modelos y evolución (MLflow futuro).
- Privacidad: datos financieros no salen a terceros sin necesidad.

## Opciones consideradas

1. **Forecasting in-process en TypeScript** (dentro de `finance-api`/worker).
2. **Servicio Python separado** (`services/ml-forecasting`, FastAPI) con ACL `@pf/forecasting` en el monolito (elegida).
3. **ML gestionado** (Amazon SageMaker, Forecast, Vertex AI, Azure ML).

## Decisión

- **Servicio Python separado** `finance-ml` (imagen propia, ADR-0011): Python + FastAPI + Polars + statsmodels / scikit-learn / Prophet; MLflow como evolución futura para tracking de modelos.
- Dentro del monolito, el contexto `FORECAST` es un **Anti-Corruption Layer** (`@pf/forecasting`): define el puerto `ForecastingPort`, almacena resultados en schema `forecasting` y expone forecasts por la API REST (`/forecasts`).
- **Integración asíncrona**: el worker solicita forecasts (job programado o bajo demanda) enviando **datasets agregados y anonimizados por workspace** (series por categoría/cuenta, sin descripciones libres) vía HTTP interno (contrato OpenAPI propio) y persiste resultados versionados (`model_version`, `generated_at`, parámetros). Alternativa a evaluar en Phase 8: el servicio lee de una vista de solo lectura con rol dedicado — solo si el volumen lo justifica.
- **Nunca en el camino crítico**: ninguna operación de escritura financiera ni lectura de saldos depende de `finance-ml`. Si el servicio no está disponible, la UI muestra el último forecast con su fecha o "no disponible".
- El servicio no tiene estado de negocio propio ni acceso de escritura a la BD.
- Profile Compose `ml` (no se levanta por defecto).

## Análisis de opciones

### 1. In-process TypeScript
- **Pros:** sin runtime adicional; acceso directo a datos vía casos de uso; despliegue único.
- **Contras:** ecosistema de forecasting en JS inmaduro (sin equivalentes sólidos a statsmodels/Prophet); cómputo CPU-bound bloquea el event loop del worker; experimentación (notebooks) desconectada de producción.
- **Costo:** 0 extra. **Complejidad operativa:** baja; **calidad de modelos:** baja.

### 2. Servicio Python separado (elegida)
- **Pros:** mejor ecosistema; aislamiento de fallos y recursos; escalado/apagado independiente (puede ser un job efímero en cloud); notebooks y producción comparten código; frontera natural (cumple el criterio 2 de extracción, ADR-0003).
- **Contras:** segundo lenguaje y toolchain (uv/ruff/pytest); contrato HTTP a mantener; otra imagen que escanear y desplegar.
- **Costo:** bajo si se ejecuta como tarea programada (Fargate task / Cloud Run Job) en lugar de servicio 24/7.
- **Complejidad operativa:** media.

### 3. ML gestionado (SageMaker / Vertex AI / Amazon Forecast)
- **Pros:** infraestructura de entrenamiento/serving gestionada, AutoML.
- **Contras:** costo desproporcionado para datasets de una persona (endpoints con costo mínimo continuo); lock-in; envío de datos financieros a servicios adicionales; Amazon Forecast dejó de aceptar nuevos clientes (2024) — señal de volatilidad de estos productos.
- **Costo:** alto. **Complejidad:** media-alta.

## Consecuencias

**Positivas**
- El core sigue siendo simple y 100% funcional sin ML.
- Modelos de calidad con herramientas estándar de la industria.
- Camino claro a MLOps (MLflow) sin tocar el monolito.

**Negativas**
- Mantenimiento de un stack Python (dependencias, seguridad, CI separado).
- Latencia y consistencia eventual de forecasts (aceptable: son estimaciones).

**Riesgos**
- Fuga de datos sensibles al servicio ML. *Mitigación:* solo agregados; red interna; sin persistencia de datasets salvo para reproducibilidad con TTL.
- Forecasts engañosos con pocos datos. *Mitigación:* umbral mínimo de historia (p. ej. ≥ 3 meses) y bandas de incertidumbre visibles; definido en spec `forecast/expense-forecasting`.

## Validación

- Phase 8: backtesting con datos del owner (MAPE/sMAPE por categoría vs baseline ingenuo "mismo mes anterior / media móvil"); el modelo solo se publica si supera al baseline.
- Test de resiliencia: `finance-ml` caído → API responde forecasts cacheados o `503` específico sin afectar endpoints financieros.
- Contract tests del API interno ML (OpenAPI).

## Notas

- Amazon Forecast cerrado a nuevos clientes desde 2024 (conocimiento previo; a verificar si se reconsidera ML gestionado).
- Versiones de librerías Python (Prophet, statsmodels, Polars): a verificar al inicio de Phase 8.
