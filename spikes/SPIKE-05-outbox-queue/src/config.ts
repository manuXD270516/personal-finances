export const PG_URL = process.env.PG_URL ?? 'postgres://spike:spike@127.0.0.1:61532/spike05';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:61579';
export const QUEUE = 'events-projection';
export const CONSUMER = 'reporting.balance-projection';
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
