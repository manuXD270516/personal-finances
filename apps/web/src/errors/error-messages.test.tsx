import { ErrorCatalog } from '@pf/platform/errors';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, missingMessages, problemMessage } from './error-messages';
import { ProblemMessage } from './ProblemMessage';

describe('catálogo de mensajes de error de la UI (platform/api-conventions)', () => {
  const codes = ErrorCatalog.codes();

  it('[TC-PLATFORM-API-005] todo código del ErrorCatalog tiene mensaje en español, inglés y portugués, sin claves sobrantes', () => {
    for (const [locale, messages] of Object.entries(ERROR_MESSAGES)) {
      expect(missingMessages(codes, messages), locale).toEqual([]);
      expect(Object.keys(messages).sort(), locale).toEqual([...codes].sort());
    }
  });

  it('[TC-PLATFORM-API-005] un código nuevo sin mensaje en español hace fallar el test nombrando el código', () => {
    expect(missingMessages([...codes, 'NUEVO_CODIGO'], ERROR_MESSAGES.es)).toEqual(['NUEVO_CODIGO']);
  });

  it('[TC-PLATFORM-API-005] la interfaz muestra el mensaje en español de PERIOD_CLOSED y no el title técnico', () => {
    const problem = {
      type: 'https://pfos.dev/problems/period-closed',
      title: 'Accounting period is closed',
      status: 409,
      code: 'PERIOD_CLOSED',
      requestId: '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d8e',
    };
    const html = renderToStaticMarkup(<ProblemMessage problem={problem} locale="es" />);
    expect(html).toContain(ERROR_MESSAGES.es['PERIOD_CLOSED']);
    expect(html).toContain('data-request-id="0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d8e"');
    expect(html).not.toContain('Accounting period is closed');
    expect(html).not.toContain('>PERIOD_CLOSED<');
  });

  it('un código desconocido o ausente cae en el mensaje genérico; un locale desconocido usa español', () => {
    expect(problemMessage({ code: 'FUTURE_CODE' }, 'es')).toBe(ERROR_MESSAGES.es['INTERNAL_ERROR']);
    expect(problemMessage({}, 'en')).toBe(ERROR_MESSAGES.en['INTERNAL_ERROR']);
    expect(problemMessage({ code: 'RATE_LIMITED' }, 'fr')).toBe(ERROR_MESSAGES.es['RATE_LIMITED']);
    expect(problemMessage({ code: 'RATE_LIMITED' }, 'pt')).toBe(ERROR_MESSAGES.pt['RATE_LIMITED']);
  });
});
