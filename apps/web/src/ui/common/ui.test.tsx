import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { ErrorSummary } from './ErrorSummary';
import { ConfirmDialog, ConfirmPanel, Field } from './ui';

const forms = esContext('Forms');
const noop = () => undefined;

describe('ErrorSummary', () => {
  const items = [
    { field: 'principal', label: 'Monto' },
    { field: 'ratePct', label: 'Tasa' },
    { field: 'firstDueDate', label: 'Primer vencimiento' },
  ];

  it('[TC-PLATFORM-WEBUI-003] muestra el conteo, es enfocable por programa y enlaza cada campo por su id', () => {
    const html = renderToStaticMarkup(
      <ErrorSummary title={forms.t('errorSummary.title', { count: items.length })} items={items} />,
    );
    expect(textOf(html)).toContain('Hay 3 errores');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-error-summary');
    expect(html).toContain('href="#field-ratePct"');
    expect((html.match(/<a /g) ?? []).length).toBe(3);
    // No es región viva: se anuncia al recibir el foco.
    expect(html).not.toMatch(/role="(alert|status)"|aria-live/);
  });

  it('[TC-PLATFORM-WEBUI-003] usa el singular con un solo error y no se muestra sin errores', () => {
    expect(forms.t('errorSummary.title', { count: 1 })).toBe('Hay 1 error');
    expect(renderToStaticMarkup(<ErrorSummary title="x" items={[]} />)).toBe('');
  });

  it('[TC-PLATFORM-WEBUI-003] el campo con anchor toma el id al que apunta el enlace', () => {
    const html = renderToStaticMarkup(
      <Field label="Tasa" error="Obligatorio" anchor="ratePct">
        {(p) => <input {...p} />}
      </Field>,
    );
    expect(html).toContain('id="field-ratePct"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="field-ratePct-error"');
  });
});

describe('ConfirmDialog y ConfirmPanel', () => {
  const props = {
    title: 'Anular transacción',
    description: 'No se puede deshacer.',
    confirmLabel: 'Anular',
    cancelLabel: 'Cancelar',
    onConfirm: noop,
    onCancel: noop,
  };

  it('[TC-PLATFORM-WEBUI-008] es un <dialog> con rol alertdialog, nombre y descripción, y Cancelar antes de confirmar', () => {
    const html = renderToStaticMarkup(<ConfirmDialog {...props} testId="void-confirm" />);
    expect(html.startsWith('<dialog')).toBe(true);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('data-testid="void-confirm"');
    expect(html).toContain('class="pf-confirm-dialog"');
    expect(html).not.toContain('aria-modal');
    expect(html).not.toContain('autofocus');
    expect(html).not.toContain(' open');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`<strong id="${labelledBy}">Anular transacción</strong>`);
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`id="${describedBy}"`);
    expect(html.indexOf('Cancelar')).toBeLessThan(html.indexOf('>Anular</button>'));
  });

  it('[TC-PLATFORM-WEBUI-008] el testId por omisión es confirm-dialog y los hijos quedan entre la descripción y los botones', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog {...props}>
        <label>
          Motivo <input name="reason" />
        </label>
      </ConfirmDialog>,
    );
    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html.indexOf('name="reason"')).toBeLessThan(html.indexOf('Cancelar'));
  });

  it('[TC-PLATFORM-WEBUI-011] la confirmación en línea mantiene el rol y pone Cancelar antes de confirmar', () => {
    const html = renderToStaticMarkup(<ConfirmPanel {...props} confirmLabel="Pausar" />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('data-testid="confirm-panel"');
    expect(html.indexOf('Cancelar')).toBeLessThan(html.indexOf('>Pausar</button>'));
  });
});
