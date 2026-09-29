import type { PresenceDevice, ServerEvent } from '@memora/shared';

/** One open event channel: a browser of a signed-in user (its one syncing tab). */
export interface EventClient {
  readonly userId: string;
  readonly sessionId: string;
  /** The browser's own id, when it sent one; its own changes aren't echoed back to it. */
  readonly deviceId: string | null;
  readonly deviceLabel: string;
  /** Pages open in that browser, for the presence hints of the others. */
  pages: readonly string[];
  send(event: ServerEvent): void;
}

const deviceKey = (c: EventClient) => c.deviceId ?? `session:${c.sessionId}`;

/**
 * Delivers live events to a user's open channels (§9.6), and tells each browser which pages
 * the user's other browsers have open. Everything is in memory and small: a set of channels
 * per signed-in user, a few hundred bytes each, dropped when a channel closes.
 */
export class EventHub {
  private readonly byUser = new Map<string, Set<EventClient>>();

  add(client: EventClient): void {
    let clients = this.byUser.get(client.userId);
    if (!clients) this.byUser.set(client.userId, (clients = new Set()));
    clients.add(client);
    this.sendPresence(client.userId);
  }

  remove(client: EventClient): void {
    const clients = this.byUser.get(client.userId);
    if (!clients?.delete(client)) return;
    if (clients.size === 0) this.byUser.delete(client.userId);
    this.sendPresence(client.userId);
  }

  setPages(client: EventClient, pages: readonly string[]): void {
    client.pages = pages;
    this.sendPresence(client.userId);
  }

  /** Sends an event to the user's channels, except the browser the change came from. */
  publish(userId: string, event: ServerEvent): void {
    const origin = 'origin' in event ? event.origin : null;
    for (const client of this.byUser.get(userId) ?? []) {
      if (origin === null || client.deviceId !== origin) client.send(event);
    }
  }

  /** Open channels; for tests and the admin System page. */
  get size(): number {
    let n = 0;
    for (const clients of this.byUser.values()) n += clients.size;
    return n;
  }

  private sendPresence(userId: string): void {
    const clients = [...(this.byUser.get(userId) ?? [])];
    for (const client of clients) {
      const devices: PresenceDevice[] = clients
        .filter((other) => deviceKey(other) !== deviceKey(client) && other.pages.length > 0)
        .map((other) => ({ label: other.deviceLabel, pages: [...other.pages] }));
      client.send({ type: 'presence', devices });
    }
  }
}
