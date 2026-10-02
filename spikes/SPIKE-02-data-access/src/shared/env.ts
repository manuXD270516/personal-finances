import pg from 'pg';

// Credenciales SOLO del spike local (ver db/init/00-roles.sql).
export const HOST = process.env.PGHOST_SPIKE ?? '127.0.0.1';
export const PORT = Number(process.env.PGPORT_SPIKE ?? 61432);
export const MIGRATOR_URL = `postgres://pf_migrator:spike-only-migrator@${HOST}:${PORT}/pf_spike`;
export const APP_URL = `postgres://pf_app:spike-only-app@${HOST}:${PORT}/pf_spike`;

// node-postgres: NUMERIC (OID 1700) ya llega como string por defecto (no se toca).
// DATE (OID 1082) por defecto se convierte a Date en zona local -> lo dejamos como string 'YYYY-MM-DD'.
pg.types.setTypeParser(1082, (v: string) => v);

export { pg };
