import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIAGRAM_KEY_GROUPS, DIAGRAM_KEYS, useShortcuts } from './shortcuts';

const pressCtrlK = () =>
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }),
  );

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shortcuts and dialogs', () => {
  it('run when nothing is open', () => {
    const palette = vi.fn();
    renderHook(() => useShortcuts({ palette }));
    pressCtrlK();
    expect(palette).toHaveBeenCalledOnce();
  });

  it('wait while a dialog is open, the global ones too (an unfinished diagram stays)', () => {
    const palette = vi.fn();
    renderHook(() => useShortcuts({ palette }));
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    pressCtrlK();
    expect(palette).not.toHaveBeenCalled();
  });

  it('pass through the command palette, which closes with its own shortcut', () => {
    const palette = vi.fn();
    renderHook(() => useShortcuts({ palette }));
    document.body.innerHTML = '<div role="dialog" data-state="open" data-shortcuts=""></div>';
    pressCtrlK();
    expect(palette).toHaveBeenCalledOnce();
  });
});

describe('the diagram editor’s keys', () => {
  it('are listed once per group, each in a group that has a name', () => {
    const seen = new Set<string>();
    for (const k of DIAGRAM_KEYS) {
      expect(DIAGRAM_KEY_GROUPS[k.group]).toBeTruthy();
      const id = `${k.group}: ${k.keys}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
    }
  });
});
