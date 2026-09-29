import { MAX_PRESENCE_PAGES, type ServerEvent } from '@memora/shared';
import { deviceId } from '../lib/device';
import type { Shared } from './status';

/*
 * The event channel (§9.6): one WebSocket per browser, kept by the leader tab, telling it
 * about changes made on other devices and which pages they have open. When it can't connect
 * (a proxy that blocks WebSockets, or no connection at all), changes are checked for every
 * 30 s instead, while it keeps trying to connect.
 */

export interface LiveHost {
  event(event: ServerEvent): void;
  setShared(patch: Partial<Shared>): void;
  /** Connected (again): catch up and send what waits. */
  opened(): void;
  /** Check for changes (polling). */
  catchUp(): void;
  /** The server ended the session. */
  signedOut(): void;
}

export const POLL_MS = 30_000;
const MAX_DELAY_MS = 60_000;
/** Failed attempts in a row before checking every 30 s meanwhile. */
const FAILURES_BEFORE_POLLING = 2;
/** The server's close code for a session that ended. */
const SIGNED_OUT = 4401;

export class Live {
  private socket: WebSocket | null = null;
  private failures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private presenceSent = '';
  private presenceWanted = '';

  constructor(private readonly host: LiveHost) {}

  start(): void {
    this.connect();
  }

  private connect() {
    clearTimeout(this.reconnectTimer);
    if (this.stopped || this.socket) return;
    if (typeof WebSocket === 'undefined') {
      this.poll();
      return;
    }
    const url = new URL('/api/v1/events', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const device = deviceId();
    if (device) url.searchParams.set('device', device);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.closed(1006);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.failures = 0;
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      this.presenceSent = '';
      this.host.setShared({ connection: 'live', reachable: true });
      this.sendPresence();
      this.host.opened();
    };
    socket.onmessage = (message) => {
      let event: unknown;
      try {
        event = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (event && typeof (event as ServerEvent).type === 'string') {
        this.host.event(event as ServerEvent);
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.closed(event.code);
    };
  }

  private closed(code: number) {
    if (this.stopped) return;
    if (code === SIGNED_OUT) {
      this.host.signedOut();
      return;
    }
    this.failures += 1;
    if (this.failures >= FAILURES_BEFORE_POLLING) {
      this.host.setShared({ connection: 'polling' });
      this.poll();
    } else {
      this.host.setShared({ connection: 'connecting' });
    }
    const delay = Math.min(MAX_DELAY_MS, 1000 * 2 ** this.failures) * (0.7 + Math.random() * 0.6);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private poll() {
    this.pollTimer ??= setInterval(() => this.host.catchUp(), POLL_MS);
  }

  /** The network is back: try now instead of waiting out the delay. */
  retryNow(): void {
    if (!this.socket && !this.stopped) this.connect();
  }

  /** Which pages this browser has open, for the user's other devices. */
  presence(pages: string[]): void {
    this.presenceWanted = JSON.stringify({
      type: 'presence',
      pages: [...new Set(pages)].slice(0, MAX_PRESENCE_PAGES),
    });
    this.sendPresence();
  }

  private sendPresence() {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!this.presenceWanted || this.presenceWanted === this.presenceSent) return;
    socket.send(this.presenceWanted);
    this.presenceSent = this.presenceWanted;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pollTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
  }
}
