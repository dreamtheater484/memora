import type { Tree } from '@memora/shared';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../notes/model';
import { resolveCurrent, windowTitle } from './location';

/*
 *   Inbox                (a page: Call the plumber)
 *   Private              (notebook)
 *     Travel             (group)
 *       Trips            (section: Lisbon, and its subpage Packing)
 */

const at = 1_000;
const tree: Tree = {
  inboxId: 'inbox',
  notebooks: [
    {
      id: 'nb',
      name: 'Private',
      color: 'coral',
      icon: 'notebook',
      sortKey: 'a',
      createdAt: at,
      updatedAt: at,
    },
  ],
  groups: [
    {
      id: 'g',
      notebookId: 'nb',
      parentGroupId: null,
      name: 'Travel',
      sortKey: 'a',
      createdAt: at,
      updatedAt: at,
    },
  ],
  sections: [
    { id: 'inbox', notebookId: null, groupId: null, name: 'Inbox', isInbox: true },
    { id: 'trips', notebookId: 'nb', groupId: 'g', name: 'Trips', isInbox: false },
  ].map((s) => ({ ...s, color: 'teal' as const, sortKey: 'a', createdAt: at, updatedAt: at })),
  pages: [
    { id: 'lisbon', sectionId: 'trips', parentPageId: null, title: 'Lisbon' },
    { id: 'packing', sectionId: 'trips', parentPageId: 'lisbon', title: 'Packing' },
    { id: 'plumber', sectionId: 'inbox', parentPageId: null, title: 'Call the plumber' },
    { id: 'untitled', sectionId: 'trips', parentPageId: null, title: '' },
  ].map((p) => ({
    ...p,
    type: 'markdown' as const,
    snippet: '',
    revision: 1,
    sortKey: p.id,
    createdAt: at,
    updatedAt: at,
  })),
};
const index = buildIndex(tree);
const place = (params: Parameters<typeof resolveCurrent>[2]) => resolveCurrent(index, {}, params);

describe('the window title', () => {
  it('names the page, then its section and notebook', () => {
    expect(windowTitle(place({ pageId: 'packing' }), null)).toBe(
      'Packing · Trips · Private — Memora',
    );
    expect(windowTitle(place({ pageId: 'untitled' }), null)).toBe(
      'Untitled page · Trips · Private — Memora',
    );
    expect(windowTitle(place({ pageId: 'plumber' }), null)).toBe(
      'Call the plumber · Inbox — Memora',
    );
  });

  it('names the page a section or notebook opens on larger screens', () => {
    expect(windowTitle(place({ sectionId: 'trips' }), null)).toBe(
      'Lisbon · Trips · Private — Memora',
    );
    expect(windowTitle(place({ notebookId: 'nb' }), null)).toBe(
      'Lisbon · Trips · Private — Memora',
    );
  });

  it('names only the level a phone shows', () => {
    expect(windowTitle(place({}), null, true)).toBe('Memora');
    expect(windowTitle(place({ notebookId: 'nb' }), null, true)).toBe('Private — Memora');
    expect(windowTitle(place({ groupId: 'g' }), null, true)).toBe('Travel · Private — Memora');
    expect(windowTitle(place({ sectionId: 'trips' }), null, true)).toBe('Trips · Private — Memora');
    expect(windowTitle(place({ pageId: 'lisbon' }), null, true)).toBe(
      'Lisbon · Trips · Private — Memora',
    );
  });

  it('names boards and the other views', () => {
    expect(windowTitle(place({ boardId: 'b' }), { name: 'Sprint', project: 'Website' })).toBe(
      'Sprint · Website — Memora',
    );
    expect(windowTitle(place({ trash: true }), null)).toBe('Recycle bin — Memora');
    expect(windowTitle(place({ search: true }), null)).toBe('Search — Memora');
    expect(windowTitle(place({ pageId: 'gone' }), null)).toBe('Not found — Memora');
  });
});
