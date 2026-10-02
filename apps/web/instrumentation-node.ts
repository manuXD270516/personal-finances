import { isNextBuildPhase, loadConfigOrExit } from '@pf/platform/config';

/** Fail-fast de configuración al arrancar el servidor (docs/19 §0.3). No aplica durante `next build`. */
export function validateWebConfig(): void {
  if (isNextBuildPhase()) return;
  loadConfigOrExit('web');
}
