import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { FastifyInstance } from 'fastify';

/** The connections open as Memora starts closing, by what they are doing (logged). */
export interface OpenConnections {
  /** Answering a request. */
  requests: number;
  /** Opened and never used, as browsers keep spare ones. */
  unused: number;
  /** Between requests, or partway through receiving one. */
  idle: number;
  /** Event channels (WebSockets). */
  eventChannels: number;
}

/**
 * Lets `app.close()` end within `graceMs`, whatever the browsers do. The desktop app ends a
 * server that hasn't stopped after 10 s, and so does `docker stop`: the database is then left
 * with its write-ahead log.
 *
 * Node's `server.close()` waits for every connection to end, and itself ends only those idle
 * between requests. Three kinds would each keep it waiting: a connection a browser opened and
 * never used, the connection of an answer still going out (kept alive after it), and an event
 * channel until its browser answers the closing handshake (ws waits up to 30 s). Here unused
 * connections end at once, and an answer's connection as soon as it is out; whatever is still
 * open after `graceMs` is cut. A request being answered gets its answer, so the change a window
 * sent as it closed is kept.
 */
export function closeConnectionsPromptly(app: FastifyInstance, graceMs: number): void {
  const sockets = new Set<Socket>();
  const answering = new Set<Socket>();
  const upgraded = new WeakSet<object>();
  let closing = false;

  app.server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  app.server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    const { socket } = request;
    answering.add(socket);
    // While closing, a connection ends once its answer is out and its request read in full
    // (an answer can go before the body has arrived).
    const ended = () => {
      if (closing) app.server.closeIdleConnections();
    };
    request.once('end', ended);
    response.once('close', () => {
      answering.delete(socket);
      ended();
    });
  });
  app.server.on('upgrade', (_request: IncomingMessage, socket: object) => upgraded.add(socket));

  const unused = (socket: Socket) =>
    !upgraded.has(socket) && !answering.has(socket) && socket.bytesRead === 0;
  const open = (): OpenConnections => {
    const counts = { requests: 0, unused: 0, idle: 0, eventChannels: 0 };
    for (const socket of sockets) {
      if (upgraded.has(socket)) counts.eventChannels += 1;
      else if (answering.has(socket)) counts.requests += 1;
      else if (unused(socket)) counts.unused += 1;
      else counts.idle += 1;
    }
    return counts;
  };

  app.addHook('preClose', async () => {
    closing = true;
    const started = performance.now();
    app.log.info({ open: open() }, 'closing connections');
    for (const socket of sockets) if (unused(socket)) socket.destroy();
    const cut = setTimeout(() => {
      app.log.warn({ open: open() }, `connections still open after ${graceMs} ms: cut`);
      for (const socket of sockets) socket.destroy();
    }, graceMs);
    cut.unref();
    app.server.once('close', () => {
      clearTimeout(cut);
      app.log.info({ ms: Math.round(performance.now() - started) }, 'connections closed');
    });
  });
}
