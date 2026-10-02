import { connect, createServer, type Server, type Socket } from 'node:net';

/**
 * Proxy TCP que se puede "cortar" y "restablecer" en el mismo puerto: simula que una dependencia deja de ser
 * alcanzable (y vuelve) sin detener el contenedor compartido por toda la suite, igual en Windows y Linux.
 */
export class ToggleableTcpProxy {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  port = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((client) => {
      const upstream = connect({ host: this.targetHost, port: this.targetPort });
      this.sockets.add(client).add(upstream);
      const cleanup = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on('error', cleanup).on('close', cleanup);
      upstream.on('error', cleanup).on('close', cleanup);
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (typeof address === 'object' && address) this.port = address.port;
  }

  /** Corta: cierra el listener y destruye las conexiones abiertas (conexión rechazada a partir de ahora). */
  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Restablece en el MISMO puerto (la app no se reinicia ni se reconfigura). */
  async restore(): Promise<void> {
    await this.start();
  }
}
