// Guard de integración: `pg` emite un DeprecationWarning cuando se llama `client.query()` con otra consulta en
// vuelo sobre el mismo cliente (p. ej. `Promise.all` de varias queries dentro de una unidad de trabajo). En pg 9
// pasará a lanzar error; aquí lo convertimos en fallo de la suite para que no vuelva a colarse.
const PG_CONCURRENT_QUERY = /client\.query\(\) when the client is already executing a query/u;

process.on('warning', (warning) => {
  if (warning.name !== 'DeprecationWarning' || !PG_CONCURRENT_QUERY.test(warning.message)) return;
  // `util.deprecate` avisa una sola vez por proceso: se relanza como excepción no capturada para que vitest
  // marque el run como fallido (el warning llega de forma asíncrona, sin pila útil del test que lo causó).
  queueMicrotask(() => {
    throw new Error(
      `pg: consultas concurrentes sobre un mismo cliente (usar await secuencial dentro de la unidad de trabajo). ${warning.message}`,
    );
  });
});
