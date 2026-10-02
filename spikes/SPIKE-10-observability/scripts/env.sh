# Variables OTEL_* estándar. Cambiar de backend = cambiar SOLO estas variables (ver README §Exportadores).
export OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:61918}
export OTEL_EXPORTER_OTLP_PROTOCOL=${OTEL_EXPORTER_OTLP_PROTOCOL:-http/protobuf}
export OTEL_RESOURCE_ATTRIBUTES=${OTEL_RESOURCE_ATTRIBUTES:-deployment.environment.name=spike,service.version=sha-spike}
export OTEL_SEMCONV_STABILITY_OPT_IN=${OTEL_SEMCONV_STABILITY_OPT_IN:-http}
export OTEL_METRIC_EXPORT_INTERVAL=${OTEL_METRIC_EXPORT_INTERVAL:-5000}
export OTEL_NODE_RESOURCE_DETECTORS=${OTEL_NODE_RESOURCE_DETECTORS:-env,os,serviceinstance}   # sin process/host: evita process_owner (nombre del usuario), args y hostname
