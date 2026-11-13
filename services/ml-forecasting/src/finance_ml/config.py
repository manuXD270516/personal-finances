"""Configuración por entorno del servicio (solo variables ML_*; sin credenciales de datos)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    token: bytes | None
    max_body_bytes: int = 2_097_152
    max_series: int = 400
    max_periods: int = 120
    compute_deadline_s: float = 240.0
    log_level: str = "INFO"


def _read_token(path: str | None) -> bytes | None:
    if not path:
        return None
    try:
        raw = Path(path).read_bytes().strip()
    except OSError:
        # Sin credencial legible el servicio no queda listo y rechaza toda petición (falla cerrado).
        return None
    return raw or None


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    e: Mapping[str, str] = os.environ if env is None else env
    return Settings(
        token=_read_token(e.get("ML_SERVICE_TOKEN_FILE")),
        max_body_bytes=int(e.get("ML_MAX_BODY_BYTES", "2097152")),
        max_series=int(e.get("ML_MAX_SERIES", "400")),
        max_periods=int(e.get("ML_MAX_PERIODS", "120")),
        compute_deadline_s=float(e.get("ML_COMPUTE_DEADLINE_S", "240")),
        log_level=e.get("ML_LOG_LEVEL", "INFO").upper(),
    )
