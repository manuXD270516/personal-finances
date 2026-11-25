import { notFound } from 'next/navigation';

/** Ruta comodín: toda URL sin página pasa por el layout (renderizado por petición, con nonce) y muestra el 404 propio. */
export default function UnmatchedPage(): never {
  notFound();
}
