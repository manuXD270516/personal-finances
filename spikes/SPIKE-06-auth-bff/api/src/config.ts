const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta variable ${k}`);
  return v;
};

export const config = {
  port: Number(process.env.API_PORT ?? 61680),
  issuer: req('OIDC_ISSUER'),
  audience: req('JWT_AUDIENCE'),
  allowedAzp: req('JWT_ALLOWED_AZP').split(',').map((s) => s.trim()),
  clockToleranceSec: 30,
  jwksCacheMaxAgeMs: 10 * 60_000,
  jwksCooldownMs: 60_000,
};
