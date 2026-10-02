// Verificación programática vía APIs de Grafana (datasource proxy) — sin screenshots.
// Requiere: otel-lgtm arriba (61930), api (61980) y worker (61981) corriendo con el SDK.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const GRAFANA = process.env.GRAFANA_URL ?? 'http://127.0.0.1:61930';
const API = process.env.API_URL ?? 'http://127.0.0.1:61980';
const AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');
const CANARY_TOKEN = 'CANARY-SECRET-7731';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { checks: {} };

async function g(path) {
  const r = await fetch(GRAFANA + path, { headers: { authorization: AUTH } });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: text };
  }
}
async function poll(label, fn, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn().catch((e) => ({ ok: false, err: String(e) }));
    if (v.ok) return { ...v, waitedMs: Date.now() - t0 };
    await sleep(2000);
  }
  return { ok: false, label, waitedMs: Date.now() - t0 };
}

// 0) datasources provisionados
const ds = await g('/api/datasources');
const uid = Object.fromEntries(ds.body.map((d) => [d.type, d.uid]));
results.datasources = uid;

// 1) generar tráfico: 1 request "canario" + 30 de relleno para métricas
const reqId = `verify-${Date.now()}`;
const r = await fetch(`${API}/transactions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${CANARY_TOKEN}`, 'x-request-id': reqId },
  body: JSON.stringify({ kind: 'expense', amount: 'CANARY-7731.42', description: 'CANARY-DESC-9911' }),
});
const created = await r.json();
results.request = { status: r.status, ...created };
for (let i = 0; i < 30; i++) {
  await fetch(`${API}/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: i % 3 ? 'expense' : 'income' }),
  });
}
const traceId = created.traceId;

// 2) Tempo: trace por id con spans de ambos servicios
results.checks.tempoTrace = await poll('tempo', async () => {
  const t = await g(`/api/datasources/proxy/uid/${uid.tempo}/api/v2/traces/${traceId}`);
  if (t.status !== 200) return { ok: false };
  const spans = [];
  for (const rs of t.body.trace?.resourceSpans ?? t.body.batches ?? []) {
    const svc = rs.resource.attributes.find((a) => a.key === 'service.name')?.value.stringValue;
    for (const ss of rs.scopeSpans ?? []) for (const s of ss.spans) spans.push({ service: svc, name: s.name, scope: ss.scope?.name });
  }
  const services = [...new Set(spans.map((s) => s.service))];
  return { ok: services.includes('finance-api') && services.includes('finance-worker') && spans.length >= 5, traceId, services, spanCount: spans.length, spans };
});
// Tempo search (TraceQL) por servicio + nombre del span manual
results.checks.tempoSearch = await poll('tempo-search', async () => {
  const q = encodeURIComponent('{ resource.service.name = "finance-worker" && name =~ "job.process.*" }');
  const s = await g(`/api/datasources/proxy/uid/${uid.tempo}/api/search?q=${q}&limit=50&start=${Math.floor(Date.now() / 1000) - 900}&end=${Math.floor(Date.now() / 1000) + 60}`);
  const ids = (s.body.traces ?? []).map((t) => t.traceID);
  return { ok: ids.includes(traceId), query: decodeURIComponent(q), found: ids.length, containsCanaryTrace: ids.includes(traceId) };
});

// 3) Loki: logs por trace_id (structured metadata) de ambos servicios
results.checks.lokiByTraceId = await poll('loki', async () => {
  const q = `{service_name=~"finance-.*"} | trace_id="${traceId}"`;
  const now = Date.now() * 1e6;
  const l = await g(`/api/datasources/proxy/uid/${uid.loki}/loki/api/v1/query_range?query=${encodeURIComponent(q)}&start=${now - 900e9}&end=${now + 60e9}&limit=100`);
  const streams = l.body.data?.result ?? [];
  const lines = streams.flatMap((s) => s.values.map((v) => ({ service: s.stream.service_name, line: v[1].slice(0, 160) })));
  const services = [...new Set(lines.map((x) => x.service))];
  return { ok: services.includes('finance-api') && services.includes('finance-worker'), query: q, count: lines.length, services, sampleLabels: streams[0]?.stream, lines };
});
// correlation_id también consultable
results.checks.lokiByCorrelationId = await poll('loki-corr', async () => {
  const q = `{service_name=~"finance-.*"} | correlation_id="${reqId}"`;
  const now = Date.now() * 1e6;
  const l = await g(`/api/datasources/proxy/uid/${uid.loki}/loki/api/v1/query_range?query=${encodeURIComponent(q)}&start=${now - 900e9}&end=${now + 60e9}&limit=100`);
  const n = (l.body.data?.result ?? []).reduce((a, s) => a + s.values.length, 0);
  return { ok: n >= 3, query: q, count: n };
});

// 4) Redacción: el token canario NO debe estar en Loki ni en stdout
results.checks.redactionLoki = await (async () => {
  // En Loki el body es solo "msg"; el resto de campos pino van como structured metadata -> se escanea todo.
  const now = Date.now() * 1e6;
  const l = await g(`/api/datasources/proxy/uid/${uid.loki}/loki/api/v1/query_range?query=${encodeURIComponent('{service_name=~"finance-.*"}')}&start=${now - 3600e9}&end=${now + 60e9}&limit=5000`);
  const streams = l.body.data?.result ?? [];
  const blob = JSON.stringify(streams);
  const canaryHits = Object.fromEntries([CANARY_TOKEN, 'CANARY-7731.42', 'CANARY-DESC-9911'].map((n) => [n, blob.split(n).length - 1]));
  const authRedacted = streams.filter((s) => s.stream.req_headers_authorization === '[REDACTED]' && s.stream.trace_id === traceId).length;
  const amountRedacted = streams.filter((s) => s.stream.input_amount === '[REDACTED]' && s.stream.trace_id === traceId).length;
  const piiResource = ['process_owner', 'host_name', 'process_command_args'].filter((k) => streams.some((s) => k in s.stream));
  return { ok: Object.values(canaryHits).every((n) => n === 0) && authRedacted > 0 && amountRedacted > 0, scannedStreams: streams.length, canaryHits, authRedacted, amountRedacted, piiResourceAttrsPresent: piiResource };
})();
results.checks.redactionStdout = (() => {
  const all = ['logs/api.log', 'logs/worker.log'].map((f) => readFileSync(f, 'utf8')).join('\n');
  const hits = Object.fromEntries([CANARY_TOKEN, 'CANARY-7731.42', 'CANARY-DESC-9911'].map((n) => [n, all.split(n).length - 1]));
  return { ok: Object.values(hits).every((n) => n === 0), hits };
})();

// 5) Prometheus/Mimir: series de métricas
const promQueries = {
  httpRedHistogram: 'sum by (service_name, http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count[5m]))',
  httpP95: 'histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{service_name="finance-api"}[5m])))',
  transactionsRecorded: 'sum by (kind) (pf_transactions_recorded_total)',
  outboxLag: 'pf_outbox_lag_seconds',
  outboxPending: 'pf_outbox_pending',
  workerJobDuration: 'sum by (outcome) (pf_queue_job_duration_seconds_count)',
};
for (const [k, q] of Object.entries(promQueries)) {
  results.checks[`prom_${k}`] = await poll(k, async () => {
    const p = await g(`/api/datasources/proxy/uid/${uid.prometheus}/api/v1/query?query=${encodeURIComponent(q)}`);
    const res = p.body.data?.result ?? [];
    return { ok: res.length > 0, query: q, series: res.slice(0, 6).map((s) => ({ metric: s.metric, value: s.value[1] })) };
  });
}

results.summary = Object.fromEntries(Object.entries(results.checks).map(([k, v]) => [k, v.ok]));
mkdirSync('results', { recursive: true });
writeFileSync('results/verify.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.summary, null, 2));
console.log('traceId', traceId, '-> results/verify.json');
process.exit(Object.values(results.summary).every(Boolean) ? 0 : 1);
