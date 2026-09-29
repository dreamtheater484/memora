import type { Root } from 'hast';

/*
 * Turns Markdown into a sanitised HTML tree in a worker, keeping only the latest request: a
 * text superseded while it was being parsed is never waited for.
 */

export interface Renderer {
  render(text: string): Promise<Root>;
  dispose(): void;
}

class WorkerRenderer implements Renderer {
  private readonly worker = new Worker(new URL('./render.worker.ts', import.meta.url), {
    type: 'module',
  });
  private next = 1;
  private readonly waiting = new Map<number, (result: Root | Error) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<{ id: number; hast?: Root; error?: string }>) => {
      const done = this.waiting.get(event.data.id);
      this.waiting.delete(event.data.id);
      done?.(event.data.hast ?? new Error(event.data.error ?? 'Rendering failed.'));
    };
  }

  render(text: string): Promise<Root> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (result) =>
        result instanceof Error ? reject(result) : resolve(result),
      );
      this.worker.postMessage({ id, text });
    });
  }

  dispose() {
    this.worker.terminate();
    this.waiting.clear();
  }
}

/** Where there are no workers (tests), the same pipeline runs here, loaded on first use. */
class DirectRenderer implements Renderer {
  async render(text: string): Promise<Root> {
    const { toHast } = await import('./pipeline');
    return toHast(text);
  }

  dispose() {}
}

export function createRenderer(): Renderer {
  return typeof Worker === 'undefined' ? new DirectRenderer() : new WorkerRenderer();
}
