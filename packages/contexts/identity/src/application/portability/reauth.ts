import { DomainError, type Instant } from '@pf/shared-kernel';
import type { ReauthPolicy } from './ports.js';

/** Tolerancia de reloj entre el IdP y la API para un `auth_time` ligeramente futuro. */
const CLOCK_SKEW_SECONDS = 60;

/**
 * Re-autenticación reciente (docs/12 §4; openspec add-workspace-export, decisión 6): la operación sensible exige que el
 * usuario se haya autenticado en el IdP hace no más de `REAUTH_MAX_AGE` (10 min por defecto). Se lee del claim `auth_time`
 * del access token. Sin claim, vencido o absurdamente futuro ⇒ `REAUTHENTICATION_REQUIRED` (el BFF reinicia el login con
 * `prompt=login`). Un refresh del token NO renueva `auth_time`: solo una autenticación nueva en el IdP lo hace.
 */
export class RecentAuthPolicy implements ReauthPolicy {
  constructor(private readonly maxAgeMs: number) {}

  assertRecent(authTimeSeconds: number | undefined, now: Instant): void {
    const required = () =>
      new DomainError('REAUTHENTICATION_REQUIRED', 'a recent authentication is required');
    if (authTimeSeconds === undefined || !Number.isFinite(authTimeSeconds)) throw required();
    const ageMs = now.epochMillis - authTimeSeconds * 1000;
    if (ageMs > this.maxAgeMs || ageMs < -CLOCK_SKEW_SECONDS * 1000) throw required();
  }
}
