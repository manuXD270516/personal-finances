# syntax=docker/dockerfile:1
# finance-ml — servicio interno de pronósticos de PFOS (ADR-0033; openspec add-ml-forecasting-service)
#   docker build -f docker/finance-ml.Dockerfile -t pfos/finance-ml:mlsvc .
# Un proceso, sin estado, sin acceso a la base de datos ni al almacenamiento de objetos. Base y `uv` fijados por versión
# y digest (docs/20 §15); Renovate los actualiza vía PR. Dependencias solo desde `uv.lock` (ruedas manylinux, sin
# compilar nada nativo en la imagen final).
ARG PYTHON_IMAGE=python:3.14-slim-bookworm@sha256:3fe1a0b6c2d6b2ebb572906cdabeca75aeb558c0c17db5ffefbcf8094871c32b
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.20@sha256:100047e74f30778ab704942321a09750d6158739573ff58bf3924085cc6cd2d8

FROM ${UV_IMAGE} AS uv

############################ build ###########################
FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
# Solo el lockfile y el manifiesto: la capa de dependencias se reutiliza mientras no cambien.
COPY services/ml-forecasting/pyproject.toml services/ml-forecasting/uv.lock ./
RUN --mount=type=cache,id=pfos-uv-cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY services/ml-forecasting/src ./src
RUN --mount=type=cache,id=pfos-uv-cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

############################ runtime #########################
FROM ${PYTHON_IMAGE} AS runtime
ARG GIT_SHA=unknown
ARG VERSION=0.0.0-dev
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="finance-ml" \
      org.opencontainers.image.description="PFOS: servicio interno de pronósticos (FastAPI + statsmodels, sin estado)" \
      org.opencontainers.image.source="https://github.com/manuXD270516/personal-finances" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
# Un hilo BLAS por proceso: no compite por la CPU del host (decisión 2 de openspec add-ml-forecasting-service).
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1
COPY --from=build /opt/venv /opt/venv
COPY --from=build /app/src /app/src
COPY docker/healthcheck.py /usr/local/lib/pfos/healthcheck.py
WORKDIR /app
# Sin shell interactiva necesaria ni escrituras en disco (compatible con `read_only: true` y `tmpfs /tmp`).
USER 10001:10001
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
    CMD ["python", "/usr/local/lib/pfos/healthcheck.py", "http://127.0.0.1:8090/health/ready"]
# Un solo proceso (`--workers 1`): el servicio atiende una petición de pronóstico a la vez.
CMD ["python", "-m", "uvicorn", "finance_ml.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8090", "--workers", "1", "--no-access-log"]
