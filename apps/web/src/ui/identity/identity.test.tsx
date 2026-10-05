import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import type { Membership } from '../session-context';
import { PreferencesView, WorkspaceSelector, WorkspaceSettingsView, type Translate } from './IdentityViews';
import {
  buildPreferencesPatch,
  buildSettingsPatch,
  isValidTimeZone,
  settingsFormOf,
  switchLocalePath,
  uiLocaleFor,
  type WorkspaceSettingsValues,
} from './logic';

const ws = esContext('Workspace').t as Translate;
const prefs = esContext('Preferences').t as Translate;
const app = esContext('App').t as Translate;
const locales = esContext('Locales');
const localeName = (tag: string) => (locales.has(tag) ? locales.t(tag) : tag);

const W1: WorkspaceSettingsValues = {
  name: 'W1 Personal Demo',
  baseCurrency: 'BOB',
  timezone: 'America/La_Paz',
  locale: 'es-BO',
  fiscalMonthStartDay: 1,
  minimumLiquidityReserve: null,
};

const noop = () => undefined;

describe('lógica de configuración del workspace (FR-IDENTITY-005)', () => {
  it('envía solo los campos cambiados: nombre, locale y día de inicio 5 (escenario "OWNER actualiza la configuración")', () => {
    const form = { ...settingsFormOf(W1, 'es-BO'), name: ' Finanzas personales ', fiscal: '5' };
    expect(buildSettingsPatch(W1, form, { locale: 'es-BO' })).toEqual({
      ok: true,
      patch: { name: 'Finanzas personales', fiscalMonthStartDay: 5 },
    });
  });

  it('sin cambios no hay nada que enviar', () => {
    expect(buildSettingsPatch(W1, settingsFormOf(W1, 'es-BO'), { locale: 'es-BO' })).toEqual({
      ok: true,
      patch: {},
    });
  });

  it('rechaza zona horaria no IANA, día 29 y nombre vacío sin llamar a la API', () => {
    const form = { ...settingsFormOf(W1, 'es-BO'), name: '  ', timezone: 'GMT-4 Bolivia', fiscal: '29' };
    const r = buildSettingsPatch(W1, form, { locale: 'es-BO' });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual({
        name: { key: 'nameRequired' },
        timezone: { key: 'timezoneInvalid' },
        fiscal: { key: 'fiscalRange' },
      });
  });

  it('reserva 1.500,00 en es-BO ⇒ "1500.00" BOB; 1500,005 BOB excede la escala; vacía ⇒ null', () => {
    const base = settingsFormOf(W1, 'es-BO');
    expect(buildSettingsPatch(W1, { ...base, reserve: '1.500,00' }, { locale: 'es-BO' })).toEqual({
      ok: true,
      patch: { minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' } },
    });
    const scale = buildSettingsPatch(W1, { ...base, reserve: '1500,005' }, { locale: 'es-BO' });
    expect(scale).toEqual({
      ok: false,
      errors: { reserve: { key: 'reserve', amountError: 'SCALE', scale: 2, currency: 'BOB' } },
    });
    const withReserve = { ...W1, minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' } };
    expect(settingsFormOf(withReserve, 'es-BO').reserve).toBe('1500,00');
    expect(
      buildSettingsPatch(
        withReserve,
        { ...settingsFormOf(withReserve, 'es-BO'), reserve: '' },
        { locale: 'es-BO' },
      ),
    ).toEqual({ ok: true, patch: { minimumLiquidityReserve: null } });
  });

  it('al cambiar la moneda base la reserva se expresa en la moneda nueva con su escala', () => {
    const withReserve = { ...W1, minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' } };
    const form = { ...settingsFormOf(withReserve, 'es-BO'), baseCurrency: 'USD', reserve: '200' };
    expect(buildSettingsPatch(withReserve, form, { locale: 'es-BO' })).toEqual({
      ok: true,
      patch: { baseCurrency: 'USD', minimumLiquidityReserve: { amount: '200.00', currency: 'USD' } },
    });
  });

  it('zonas IANA: America/La_Paz y UTC válidas; "Bolivia/LaPaz" y "GMT-4 Bolivia" no', () => {
    expect(isValidTimeZone('America/La_Paz')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Bolivia/LaPaz')).toBe(false);
    expect(isValidTimeZone('GMT-4 Bolivia')).toBe(false);
  });
});

describe('lógica de preferencias personales (FR-IDENTITY-003)', () => {
  const me = { displayName: 'Owner Demo', locale: 'es-BO', timezone: 'America/La_Paz' };

  it('locale en-US y zona America/Sao_Paulo (escenario "Actualización de locale y zona horaria")', () => {
    expect(buildPreferencesPatch(me, { ...me, locale: 'en-US', timezone: 'America/Sao_Paulo' })).toEqual({
      ok: true,
      patch: { locale: 'en-US', timezone: 'America/Sao_Paulo' },
    });
  });

  it('zona "Bolivia/LaPaz" y nombre vacío se rechazan en el cliente', () => {
    expect(buildPreferencesPatch(me, { ...me, displayName: ' ', timezone: 'Bolivia/LaPaz' })).toEqual({
      ok: false,
      errors: { displayName: 'displayNameRequired', timezone: 'timezoneInvalid' },
    });
  });

  it('el locale de la preferencia decide el idioma de la UI y la ruta equivalente', () => {
    expect(uiLocaleFor('es-BO')).toBe('es');
    expect(uiLocaleFor('en-US')).toBe('en');
    expect(uiLocaleFor('pt-BR')).toBe('pt');
    expect(uiLocaleFor('fr-FR')).toBe('es');
    expect(switchLocalePath('/preferencias?guardado=1', 'en')).toBe('/en/preferencias?guardado=1');
    expect(switchLocalePath('/en/preferencias', 'pt')).toBe('/pt/preferencias');
    expect(switchLocalePath('/pt/preferencias', 'es')).toBe('/preferencias');
    expect(switchLocalePath('/en', 'es')).toBe('/');
    expect(switchLocalePath('/', 'pt')).toBe('/pt');
  });
});

describe('WorkspaceSettingsView', () => {
  const props = {
    t: ws,
    localeName,
    uiLocale: 'es',
    form: settingsFormOf(W1, 'es-BO'),
    original: W1,
    errors: {},
    isOwner: true,
    busy: false,
    notice: undefined,
    problem: undefined,
    onChange: noop,
    onSubmit: noop,
    onReloadLatest: noop,
  } as const;

  it('muestra los seis campos rotulados en español con el locale es-BO por nombre', () => {
    const html = renderToStaticMarkup(<WorkspaceSettingsView {...props} />);
    const text = textOf(html);
    for (const label of [
      'Configuración del espacio de trabajo',
      'Nombre',
      'Moneda base',
      'Zona horaria',
      'Idioma y formato',
      'Día de inicio del mes financiero',
      'Reserva mínima de liquidez (BOB)',
    ])
      expect(text).toContain(label);
    expect(html).toContain('value="W1 Personal Demo"');
    expect(html).toMatch(/<option value="es-BO" selected="">Español \(Bolivia\)<\/option>/);
    expect(html).not.toContain('data-testid="settings-read-only"');
    expect(html).not.toContain('data-testid="base-currency-warning"');
  });

  it('para EDITOR/VIEWER avisa que solo el propietario modifica', () => {
    const html = renderToStaticMarkup(<WorkspaceSettingsView {...props} isOwner={false} />);
    expect(textOf(html)).toContain('Solo el propietario puede modificar esta configuración.');
  });

  it('errores por campo con aria-invalid y la escala de la moneda en el mensaje', () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsView
        {...props}
        errors={{
          timezone: { key: 'timezoneInvalid' },
          reserve: { key: 'reserve', amountError: 'SCALE', scale: 2, currency: 'BOB' },
        }}
      />,
    );
    expect(textOf(html)).toContain('No es una zona horaria IANA válida (por ejemplo America/La_Paz).');
    expect(textOf(html)).toContain('BOB admite hasta 2 decimales.');
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
  });

  it('cambiar la moneda base advierte que la historia no se modifica', () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsView {...props} form={{ ...props.form, baseCurrency: 'USD' }} />,
    );
    expect(textOf(html)).toContain(
      'Cambiar la moneda base no modifica montos, asientos ni tasas ya registrados',
    );
    expect(textOf(html)).toContain('Reserva mínima de liquidez (USD)');
  });

  it('412 PRECONDITION_FAILED: mensaje del catálogo y botón para cargar la versión actual', () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsView {...props} problem={{ code: 'PRECONDITION_FAILED', status: 412 }} />,
    );
    expect(html).toContain('data-error-code="PRECONDITION_FAILED"');
    expect(textOf(html)).toContain('Este registro cambió desde que lo abriste.');
    expect(html).toContain('data-testid="reload-latest"');
    const other = renderToStaticMarkup(
      <WorkspaceSettingsView {...props} problem={{ code: 'INSUFFICIENT_ROLE', status: 403 }} />,
    );
    expect(other).not.toContain('data-testid="reload-latest"');
  });

  it('avisos de guardado y de "sin cambios" como role=status', () => {
    expect(textOf(renderToStaticMarkup(<WorkspaceSettingsView {...props} notice="saved" />))).toContain(
      'Cambios guardados.',
    );
    expect(textOf(renderToStaticMarkup(<WorkspaceSettingsView {...props} notice="noChanges" />))).toContain(
      'No hay cambios para guardar.',
    );
  });
});

describe('PreferencesView', () => {
  const props = {
    t: prefs,
    localeName,
    uiLocale: 'es',
    form: { displayName: 'Owner Demo', locale: 'es-BO', timezone: 'America/La_Paz' },
    errors: {},
    busy: false,
    notice: undefined,
    problem: undefined,
    onChange: noop,
    onSubmit: noop,
    onReloadLatest: noop,
  } as const;

  it('ofrece es-BO, en-US y pt-BR por su nombre y explica que el idioma cambia al guardar', () => {
    const html = renderToStaticMarkup(<PreferencesView {...props} />);
    expect(html).toContain('<option value="es-BO" selected="">Español (Bolivia)</option>');
    expect(html).toContain('<option value="en-US">English (United States)</option>');
    expect(html).toContain('<option value="pt-BR">Português (Brasil)</option>');
    expect(textOf(html)).toContain('La pantalla cambia de idioma al guardar.');
  });

  it('un locale fuera de la lista sugerida se conserva como opción', () => {
    const html = renderToStaticMarkup(
      <PreferencesView {...props} form={{ ...props.form, locale: 'es-AR' }} />,
    );
    expect(html).toContain('<option value="es-AR" selected="">es-AR</option>');
  });

  it('error de zona horaria junto al campo', () => {
    const html = renderToStaticMarkup(
      <PreferencesView {...props} errors={{ timezone: 'timezoneInvalid' }} />,
    );
    expect(textOf(html)).toContain('No es una zona horaria IANA válida');
    expect(html).toContain('aria-invalid="true"');
  });
});

describe('WorkspaceSelector (FR-IDENTITY-007)', () => {
  const memberships: Membership[] = [
    { workspaceId: 'w1', workspaceName: 'W1 Personal Demo', role: 'OWNER' },
    { workspaceId: 'w2', workspaceName: 'W2 Other Demo', role: 'EDITOR' },
    { workspaceId: 'wd', workspaceName: 'Demo', role: 'OWNER', isDemo: true },
  ];

  it('lista los workspaces del usuario, marca el activo con su rol y rotula el de demostración', () => {
    const html = renderToStaticMarkup(
      <WorkspaceSelector t={app} memberships={memberships} activeId="w2" busy={false} onSelect={noop} />,
    );
    expect(html).toContain('<option value="w2" selected="">W2 Other Demo</option>');
    expect(html).toContain('<option value="wd">Demo (demostración)</option>');
    expect(textOf(html)).toContain('Espacio de trabajo activo');
    expect(textOf(html)).toContain('Tu rol: Editor');
    expect(textOf(html)).toContain('Espacio de trabajo activo: W2 Other Demo.');
  });

  it('mientras cambia de workspace el selector queda deshabilitado y lo anuncia', () => {
    const html = renderToStaticMarkup(
      <WorkspaceSelector t={app} memberships={memberships} activeId="w1" busy onSelect={noop} />,
    );
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(textOf(html)).toContain('Cambiando de espacio de trabajo…');
  });
});
