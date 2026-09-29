import type { ServerEvent } from '@memora/shared';
import { describe, expect, it } from 'vitest';
import { EventHub, type EventClient } from './hub';

function client(userId: string, deviceId: string | null, label: string, sessionId = deviceId) {
  const received: ServerEvent[] = [];
  const c: EventClient & { received: ServerEvent[] } = {
    userId,
    sessionId: sessionId ?? 's',
    deviceId,
    deviceLabel: label,
    pages: [],
    received,
    send: (e) => received.push(e),
  };
  return c;
}

const lastPresence = (c: { received: ServerEvent[] }) =>
  c.received.filter((e) => e.type === 'presence').at(-1);

describe('the event hub', () => {
  it('sends events to the user’s other browsers only', () => {
    const hub = new EventHub();
    const laptop = client('u1', 'laptop', 'Firefox on Linux');
    const phone = client('u1', 'phone', 'Safari on iPhone');
    const other = client('u2', 'tablet', 'Chrome on Android');
    [laptop, phone, other].forEach((c) => hub.add(c));
    hub.publish('u1', { type: 'tree.changed', origin: 'laptop' });
    hub.publish('u1', { type: 'tree.changed', origin: null });
    const trees = (c: { received: ServerEvent[] }) =>
      c.received.filter((e) => e.type === 'tree.changed').length;
    expect([trees(laptop), trees(phone), trees(other)]).toEqual([1, 2, 0]);
  });

  it('keeps presence current as browsers open pages and leave', () => {
    const hub = new EventHub();
    const laptop = client('u1', 'laptop', 'Firefox on Linux');
    const phone = client('u1', 'phone', 'Safari on iPhone');
    hub.add(laptop);
    hub.add(phone);
    hub.setPages(phone, ['p1']);
    expect(lastPresence(laptop)).toEqual({
      type: 'presence',
      devices: [{ label: 'Safari on iPhone', pages: ['p1'] }],
    });
    expect(lastPresence(phone)).toEqual({ type: 'presence', devices: [] });
    hub.remove(phone);
    expect(lastPresence(laptop)).toEqual({ type: 'presence', devices: [] });
    hub.remove(laptop);
    expect(hub.size).toBe(0);
  });

  it('counts two channels of one browser as one device', () => {
    const hub = new EventHub();
    const tabA = client('u1', 'laptop', 'Firefox on Linux', 's1');
    const tabB = client('u1', 'laptop', 'Firefox on Linux', 's1');
    const anonymous = client('u1', null, 'Browser', 's2');
    [tabA, tabB, anonymous].forEach((c) => hub.add(c));
    hub.setPages(tabB, ['p1']);
    expect(lastPresence(tabA)).toEqual({ type: 'presence', devices: [] });
    expect(lastPresence(anonymous)).toEqual({
      type: 'presence',
      devices: [{ label: 'Firefox on Linux', pages: ['p1'] }],
    });
  });
});
