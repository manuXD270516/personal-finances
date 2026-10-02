import { liveness } from '../../../../src/health';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return liveness();
}
