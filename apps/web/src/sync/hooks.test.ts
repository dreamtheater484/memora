import { describe, expect, it } from 'vitest';
import type { DocSnapshot } from './doc';
import { globalSaveState, pageSaveState } from './hooks';
import { fromServer, settle } from './records';
import { initialShared } from './status';

const sync = { ...initialShared, online: true, durable: true, storageError: null, unsaved: [] };
const clean = fromServer('p1', { revision: 1, content: 'Hi', type: 'markdown' }, 0);
const snapshot = (patch: Partial<DocSnapshot>): DocSnapshot => ({
  state: 'ready',
  record: clean,
  unpersisted: false,
  fallback: false,
  ...patch,
});

describe('a page’s save state', () => {
  it('claims nothing while this browser doesn’t have the page', () => {
    expect(pageSaveState(null, sync, 'p1')).toBeNull();
    expect(pageSaveState(snapshot({ state: 'loading', record: undefined }), sync, 'p1')).toBeNull();
  });

  it('is saved only with nothing typed or waiting', () => {
    expect(pageSaveState(snapshot({}), sync, 'p1')).toBe('saved');
    expect(pageSaveState(snapshot({ unpersisted: true }), sync, 'p1')).toBe('saving');
    const dirty = settle({ ...clean, content: 'Hello' });
    expect(pageSaveState(snapshot({ record: dirty }), { ...sync, reachable: false }, 'p1')).toBe(
      'local',
    );
    expect(pageSaveState(snapshot({ record: dirty, fallback: true }), sync, 'p1')).toBe('failed');
  });
});

describe('the app bar’s save state', () => {
  it('claims nothing until what waits has been counted', () => {
    expect(globalSaveState(sync)).toBeNull();
    expect(globalSaveState({ ...sync, counted: true })).toBe('saved');
    expect(globalSaveState({ ...sync, unsaved: ['p1'] })).toBe('saving');
  });

  it('shows the worst of what waits', () => {
    const counted = { ...sync, counted: true, pending: 2 };
    expect(globalSaveState(counted)).toBe('saving');
    expect(globalSaveState({ ...counted, online: false })).toBe('local');
    expect(globalSaveState({ ...counted, conflicts: ['p1'] })).toBe('conflict');
    expect(globalSaveState({ ...counted, storageError: 'QuotaExceededError' })).toBe('failed');
  });
});
