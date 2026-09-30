import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from '../components/ui/toast-store';
import { watchUpdates } from './worker';

/* The prompt when a new version of Memora is ready (Phase 11). */

class FakeWorker extends EventTarget {
  state = 'installing';
  readonly messages: unknown[] = [];
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  become(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
}

function fakeContainer(controlled: boolean) {
  const registration = new FakeRegistration();
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? {} : null,
    register: vi.fn(() => Promise.resolve(registration)),
  });
  return { container: container as unknown as ServiceWorkerContainer, registration };
}

const titles = () => useToasts.getState().toasts.map((t) => t.title);

afterEach(() => {
  useToasts.setState({ toasts: [] });
  vi.useRealTimers();
});

describe('a new version', () => {
  it('is offered once installed, and Reload starts it and reloads', async () => {
    vi.useFakeTimers();
    const { container, registration } = fakeContainer(true);
    const reload = vi.fn();
    await watchUpdates(container, reload);
    const next = new FakeWorker();
    registration.installing = next;
    registration.dispatchEvent(new Event('updatefound'));
    next.become('installed');
    expect(titles()).toEqual(['A new version of Memora is ready']);
    useToasts.getState().toasts[0]!.action!.onClick();
    expect(next.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
    // It looks for new versions every hour.
    vi.advanceTimersByTime(60 * 60_000);
    expect(registration.update).toHaveBeenCalledOnce();
  });

  it('is not offered on the first visit, when nothing controlled the page', async () => {
    const { container, registration } = fakeContainer(false);
    await watchUpdates(container, vi.fn());
    const first = new FakeWorker();
    registration.installing = first;
    registration.dispatchEvent(new Event('updatefound'));
    first.become('installed');
    // It then takes the page over: still not an update.
    container.dispatchEvent(new Event('controllerchange'));
    expect(titles()).toEqual([]);
  });

  it('started by another tab is told about', async () => {
    const { container } = fakeContainer(true);
    const reload = vi.fn();
    await watchUpdates(container, reload);
    container.dispatchEvent(new Event('controllerchange'));
    expect(titles()).toEqual(['Memora was updated in another tab']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('waiting from an earlier visit is offered at once', async () => {
    const { container, registration } = fakeContainer(true);
    registration.waiting = new FakeWorker();
    container.register = vi.fn(() => Promise.resolve(registration)) as never;
    await watchUpdates(container, vi.fn());
    expect(titles()).toEqual(['A new version of Memora is ready']);
  });
});
