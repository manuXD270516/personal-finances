/**
 * Rutas que pino reemplaza por `[REDACTED]` (docs/18 §3.2, NFR-SEC-015). Es la red de seguridad: los logs de
 * petición ya usan un serializer allow-list y nunca incluyen headers ni body.
 */
const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'access_token',
  'refresh_token',
  'id_token',
  'password',
  'secret',
  'apiKey',
  'api_key',
  'presignedUrl',
  // Datos financieros y de documentos
  'amount',
  'balance',
  'description',
  'note',
  'notes',
  'accountNumber',
  'content',
  'document',
  'documentContent',
  'fileContent',
  'body',
];

const bracket = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `["${k}"]`);
const join = (prefix: string, k: string) => {
  const b = bracket(k);
  return b.startsWith('[') ? `${prefix}${b}` : `${prefix}.${b}`;
};

export const REDACT_PATHS: readonly string[] = [
  ...SENSITIVE_KEYS.map(bracket),
  ...SENSITIVE_KEYS.map((k) => join('*', k)),
  ...SENSITIVE_KEYS.map((k) => join('*.*', k)),
  ...['authorization', 'cookie', 'set-cookie'].flatMap((k) => [
    join('req.headers', k),
    join('res.headers', k),
    join('headers', k),
  ]),
];

export const REDACTION_CENSOR = '[REDACTED]';
