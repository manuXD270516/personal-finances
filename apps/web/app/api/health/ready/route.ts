import { readiness } from '../../../../src/health';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return readiness();
}
