// Spectral (PFOS, add-api-conventions design §7): una operación `deprecated: true` declara `x-deprecated-at` y
// `x-sunset` (YYYY-MM-DD) y la fecha de retiro queda al menos 90 días después del anuncio (spec "Deprecación
// anunciada con cabeceras").
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MIN_DAYS = 90;

const parse = (value) => (typeof value === 'string' && DATE.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN);

export default function pfosSunsetWindow(operation) {
  if (!operation || typeof operation !== 'object' || operation.deprecated !== true) return [];
  const announced = parse(operation['x-deprecated-at']);
  const sunset = parse(operation['x-sunset']);
  if (Number.isNaN(announced)) return [{ message: 'deprecated operation needs x-deprecated-at (YYYY-MM-DD)' }];
  if (Number.isNaN(sunset)) return [{ message: 'deprecated operation needs x-sunset (YYYY-MM-DD)' }];
  const days = Math.round((sunset - announced) / DAY_MS);
  return days >= MIN_DAYS ? [] : [{ message: `x-sunset is ${days} days after x-deprecated-at (minimum ${MIN_DAYS})` }];
}
