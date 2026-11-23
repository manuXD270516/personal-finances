/** Imágenes de dependencias para Testcontainers: mismas que el stack Compose (paridad, docs/19 §0.6). */
export const POSTGRES_IMAGE =
  'postgres:18.7-trixie@sha256:eb63372c1e05c755f55fa30cbd07aecc443676fc6c0fa90b9002d01537841e1a';
/** SeaweedFS fijado por versión y digest (SPIKE-07 / ADR-0009). */
export const SEAWEEDFS_IMAGE =
  'chrislusf/seaweedfs:4.53@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0';
/** Mailpit (servidor SMTP de pruebas): la misma imagen fijada de Compose; captura los emails sin salir a internet. */
export const MAILPIT_IMAGE =
  'axllent/mailpit:v1.33.1@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce';
