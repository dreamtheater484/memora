import type { PageMeta, Section, Tree } from '@memora/shared';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { treeKey } from '../notes/keys';
import { SyncEngine } from './engine';
import type { LocalStore } from './store';

// Open pages ask the server for their text; here it never answers.
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: () => new Promise(() => {}),
}));

const inbox: Section = {
  id: 'inbox',
  notebookId: null,
  groupId: null,
  name: 'Inbox',
  color: 'slate',
  sortKey: 'a0',
  isInbox: true,
  createdAt: 1,
  updatedAt: 1,
};
const page = (id: string, revision = 1): PageMeta => ({
  id,
  sectionId: 'inbox',
  parentPageId: null,
  title: id,
  type: 'markdown',
  sortKey: 'a0',
  snippet: '',
  revision,
  createdAt: 1,
  updatedAt: 1,
});

describe('the sync engine', () => {
  let client: QueryClient;
  let engine: SyncEngine;
  const tree = () => client.getQueryData<Tree>(treeKey)!;
  const setPages = (pages: PageMeta[]) =>
    client.setQueryData<Tree>(treeKey, {
      inboxId: 'inbox',
      notebooks: [],
      groups: [],
      sections: [inbox],
      pages,
    });

  beforeEach(() => {
    client = new QueryClient();
    setPages([page('p')]);
    const store = { durable: false, get: () => Promise.resolve(undefined) };
    engine = new SyncEngine('u1', store as unknown as LocalStore, client, {
      onSignedOut: () => {},
      refreshSession: () => Promise.resolve(true),
    });
  });

  it('shows a page changed elsewhere in the tree at once', () => {
    engine.event({
      type: 'page.updated',
      page: { ...page('p', 2), title: 'Plans' },
      revision: 2,
      origin: null,
    });
    expect(tree().pages[0]).toMatchObject({ title: 'Plans', revision: 2 });
  });

  it('loads the tree again after it changed, whatever pages come in meanwhile', () => {
    // Nothing shows the tree (Settings is open, say): the change only marks it to load again,
    // and the pages sync announces after it mustn't make it look current.
    engine.event({ type: 'tree.changed', origin: null });
    engine.event({ type: 'page.updated', page: page('q'), revision: 1, origin: null });
    expect(client.getQueryState(treeKey)?.isInvalidated).toBe(true);
    expect(tree().pages.map((p) => p.id)).toEqual(['p']);
  });
});
