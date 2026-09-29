import type { PageMeta, Section, Tree } from '@memora/shared';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotesActions, treeKey } from './queries';

interface Sent {
  method: string;
  path: string;
  resolve: (value: unknown) => void;
}

// Requests wait here until a test answers them, one at a time.
const sent: Sent[] = [];
vi.mock('../lib/api', () => ({
  api: (method: string, path: string) =>
    new Promise((resolve) => sent.push({ method, path, resolve })),
  errorMessage: String,
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
const page = (id: string, sortKey: string): PageMeta => ({
  id,
  sectionId: 'inbox',
  parentPageId: null,
  title: id,
  type: 'markdown',
  sortKey,
  snippet: '',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
});

describe('notes actions', () => {
  let client: QueryClient;
  const tree = () => client.getQueryData<Tree>(treeKey)!;
  const titles = () => tree().pages.map((p) => p.title);

  beforeEach(() => {
    sent.length = 0;
    client = new QueryClient();
    client.setQueryData<Tree>(treeKey, {
      inboxId: 'inbox',
      notebooks: [],
      groups: [],
      sections: [inbox],
      pages: [page('p', 'a0'), page('q', 'a1')],
    });
  });

  it('show changes at once and send them one at a time, in order', async () => {
    const actions = createNotesActions(client);
    void actions.updatePage('p', { title: 'Plans' });
    void actions.updatePage('q', { title: 'Questions' });
    expect(titles()).toEqual(['Plans', 'Questions']);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: 'PATCH', path: '/pages/p' });

    sent[0]!.resolve({ pages: [{ ...page('p', 'a0'), title: 'Plans' }] });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ path: '/pages/q' });
    // The first answer doesn't undo the second change, still on its way.
    expect(titles()).toEqual(['Plans', 'Questions']);
  });

  it('don’t bring back a page deleted while an earlier change was on its way', async () => {
    const actions = createNotesActions(client);
    void actions.updatePage('p', { title: 'Plans' });
    void actions.deletePages(['p']);
    expect(titles()).toEqual(['q']);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    // The rename's answer includes the page, which is in the recycle bin by now.
    sent[0]!.resolve({ pages: [{ ...page('p', 'a0'), title: 'Plans' }] });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(titles()).toEqual(['q']);

    sent[1]!.resolve({ deleted: [{ type: 'page', id: 'p' }] });
    await vi.waitFor(() => expect(titles()).toEqual(['q']));
  });
});
