import { problemMessage, type ProblemLike } from './error-messages';

/**
 * Muestra un error de la API por su `code` en el idioma del usuario (catálogo `errors.<locale>.json`). El
 * `requestId` se expone como atributo para soporte, sin texto literal en el componente.
 */
export function ProblemMessage({ problem, locale }: { problem: ProblemLike; locale: string }) {
  const requestId = typeof problem.requestId === 'string' ? problem.requestId : undefined;
  return (
    <p
      role="alert"
      data-error-code={typeof problem.code === 'string' ? problem.code : undefined}
      data-request-id={requestId}
    >
      {problemMessage(problem, locale)}
    </p>
  );
}
