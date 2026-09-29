import { DEVICE_HEADER, clientEventSchema, deviceIdSchema, type ServerEvent } from '@memora/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { checkOrigin } from '../auth/plugin';
import type { EventClient } from '../events/hub';
import { authOf, type RouteDeps } from './auth';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** A successful request changed the tree: other browsers of the user reload it. */
    emits?: 'tree';
  }
}

/** Pings find dead connections; each ping also checks the session is still good. */
const HEARTBEAT_MS = 30_000;
/** Messages a browser may send per heartbeat (presence updates); more closes the channel. */
const MAX_MESSAGES_PER_BEAT = 60;
/** WebSocket close codes: 4401 tells the browser its session ended, so it stops reconnecting. */
const SIGNED_OUT = 4401;
const POLICY = 1008;

/** The browser a request came from (`X-Memora-Device`), if it said. */
export function deviceOf(request: FastifyRequest): string | null {
  const parsed = deviceIdSchema.safeParse(request.headers[DEVICE_HEADER]);
  return parsed.success ? parsed.data : null;
}

/**
 * The event channel, `/api/v1/events` (§9.6, §10): a WebSocket per browser that tells it
 * about changes made elsewhere and which pages the user's other devices have open.
 */
export function eventRoutes(app: FastifyInstance, { auth, events, config }: RouteDeps): void {
  const baseOrigin = config.baseUrl ? new URL(config.baseUrl).origin : undefined;

  // Tree changes, announced once the answer has gone out.
  app.addHook('onResponse', async (request, reply) => {
    if (request.routeOptions.config.emits !== 'tree' || reply.statusCode >= 400) return;
    if (!request.auth) return;
    events.publish(request.auth.user.id, { type: 'tree.changed', origin: deviceOf(request) });
  });

  app.get(
    '/api/v1/events',
    {
      websocket: true,
      config: { access: 'user' },
      // An upgrade is a GET, which skips the CSRF check: only Memora's own pages may connect.
      preValidation: async (request) => checkOrigin(request, baseOrigin, true),
    },
    (socket, request) => {
      const { user, session } = authOf(request);
      const device = deviceIdSchema.safeParse((request.query as { device?: unknown }).device);
      const client: EventClient = {
        userId: user.id,
        sessionId: session.id,
        deviceId: device.success ? device.data : null,
        deviceLabel: session.deviceLabel,
        pages: [],
        send(event: ServerEvent) {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
        },
      };
      events.add(client);

      let alive = true;
      let messages = 0;
      const heartbeat = setInterval(() => {
        if (!auth.isActive(session.id)) return socket.close(SIGNED_OUT, 'Signed out');
        if (!alive) return socket.terminate();
        alive = false;
        messages = 0;
        socket.ping();
      }, HEARTBEAT_MS);
      heartbeat.unref();

      socket.on('pong', () => {
        alive = true;
      });
      socket.on('message', (data, isBinary) => {
        alive = true;
        if (isBinary || ++messages > MAX_MESSAGES_PER_BEAT) {
          return socket.close(POLICY, 'Too many messages');
        }
        let message: unknown;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        const parsed = clientEventSchema.safeParse(message);
        if (parsed.success) events.setPages(client, [...new Set(parsed.data.pages)]);
      });
      socket.on('close', () => {
        clearInterval(heartbeat);
        events.remove(client);
      });
    },
  );
}
