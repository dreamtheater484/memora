import { create } from 'zustand';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: 'neutral' | 'success' | 'error';
  /** One action, for example "Undo". */
  action?: { label: string; onClick: () => void };
  /** Milliseconds; defaults to 5 s, or 8 s when there is an action. */
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastState {
  toasts: ToastEntry[];
  push: (t: ToastOptions) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    // At most three at once; the oldest goes first.
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Shows a short notification. Returns an id for `dismissToast`. */
export function toast(options: ToastOptions | string): number {
  return useToasts.getState().push(typeof options === 'string' ? { title: options } : options);
}

export function dismissToast(id: number) {
  useToasts.getState().dismiss(id);
}
