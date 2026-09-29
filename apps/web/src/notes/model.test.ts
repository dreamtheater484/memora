import {
  keysBetween,
  type Notebook,
  type PageMeta,
  type Section,
  type SectionGroup,
  type Tree,
} from '@memora/shared';
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  checkGroupMove,
  checkPagePlace,
  indentPlace,
  mergeChanges,
  outdentPlace,
  planGroupMove,
  planPagesMove,
  planSectionMove,
  removeItems,
  shiftBefore,
  shiftPlace,
  topmostPages,
} from './model';

/*
 * A small tree, written as nested lists so its shape is easy to read:
 *
 *   Inbox
 *   Work
 *     Plans              (section)
 *       a
 *         a1
 *           a1x
 *       b
 *       c
 *     Clients            (group)
 *       Acme             (section)
 *       Archive          (group)
 *         Old            (section)
 *   Home
 *     Garden             (section)
 */

const at = 1_000;
const sorted = <T>(items: T[]) => {
  const keys = keysBetween(null, null, items.length);
  return items.map((item, i) => ({ ...item, sortKey: keys[i]! }));
};

function notebook(id: string): Omit<Notebook, 'sortKey'> {
  return { id, name: id, color: 'blue', icon: 'notebook', createdAt: at, updatedAt: at };
}

function section(
  id: string,
  notebookId: string | null,
  groupId: string | null = null,
): Omit<Section, 'sortKey'> {
  return {
    id,
    notebookId,
    groupId,
    name: id,
    color: 'teal',
    isInbox: notebookId === null,
    createdAt: at,
    updatedAt: at,
  };
}

function group(
  id: string,
  notebookId: string,
  parentGroupId: string | null = null,
): Omit<SectionGroup, 'sortKey'> {
  return { id, notebookId, parentGroupId, name: id, createdAt: at, updatedAt: at };
}

function page(
  id: string,
  sectionId: string,
  parentPageId: string | null = null,
): Omit<PageMeta, 'sortKey'> {
  return {
    id,
    sectionId,
    parentPageId,
    title: id,
    type: 'markdown',
    snippet: '',
    revision: 1,
    createdAt: at,
    updatedAt: at,
  };
}

function sample(): Tree {
  return {
    inboxId: 'inbox',
    notebooks: sorted([notebook('work'), notebook('home')]),
    groups: [
      ...sorted([group('clients', 'work')]),
      ...sorted([group('archive', 'work', 'clients')]),
    ],
    sections: [
      ...sorted([section('inbox', null)]),
      ...sorted([section('plans', 'work')]),
      ...sorted([section('acme', 'work', 'clients')]),
      ...sorted([section('old', 'work', 'archive')]),
      ...sorted([section('garden', 'home')]),
    ],
    pages: [
      ...sorted([page('a', 'plans'), page('b', 'plans'), page('c', 'plans')]),
      ...sorted([page('a1', 'plans', 'a')]),
      ...sorted([page('a1x', 'plans', 'a1')]),
    ],
  };
}

const titles = (tree: Tree, sectionId: string) =>
  buildIndex(tree)
    .pagesOf(sectionId)
    .map((r) => `${'-'.repeat(r.depth - 1)}${r.page.id}`);

describe('the notes index', () => {
  const index = buildIndex(sample());

  it('lists pages in outline order, subpages after their parent', () => {
    expect(index.pagesOf('plans').map((r) => [r.page.id, r.depth, r.hasChildren])).toEqual([
      ['a', 1, true],
      ['a1', 2, true],
      ['a1x', 3, false],
      ['b', 1, false],
      ['c', 1, false],
    ]);
    expect(index.pagesOf('garden')).toEqual([]);
  });

  it('reads a notebook’s sections in order, groups after its own sections', () => {
    expect(index.allSectionsOf('work').map((s) => s.id)).toEqual(['plans', 'acme', 'old']);
    expect(index.allSectionsOf('work', 'clients').map((s) => s.id)).toEqual(['acme', 'old']);
    expect(index.sectionsIn('work', null).map((s) => s.id)).toEqual(['plans']);
    expect(index.groupsIn('work', 'clients').map((g) => g.id)).toEqual(['archive']);
  });

  it('knows the way to a section', () => {
    const path = index.pathOf('old')!;
    expect(path.notebook?.id).toBe('work');
    expect(path.groups.map((g) => g.id)).toEqual(['clients', 'archive']);
    expect(index.pathOf('inbox')).toMatchObject({ notebook: null, groups: [] });
    expect(index.inbox.id).toBe('inbox');
  });
});

describe('applying changes', () => {
  it('replaces known rows and adds new ones', () => {
    const tree = sample();
    const renamed = { ...tree.pages.find((p) => p.id === 'b')!, title: 'Bee' };
    const added = { ...renamed, id: 'd', title: 'Dee', sortKey: 'zz' };
    const next = mergeChanges(tree, { pages: [renamed, added] });
    expect(next.pages).toHaveLength(tree.pages.length + 1);
    expect(next.pages.find((p) => p.id === 'b')?.title).toBe('Bee');
    expect(next.notebooks).toBe(tree.notebooks);
  });

  it('removes deleted items with everything inside them', () => {
    const tree = sample();
    const noGroup = removeItems(tree, [{ type: 'group', id: 'clients' }]);
    expect(noGroup.groups).toEqual([]);
    expect(noGroup.sections.map((s) => s.id)).toEqual(['inbox', 'plans', 'garden']);

    const noPage = removeItems(tree, [{ type: 'page', id: 'a1' }]);
    expect(noPage.pages.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);

    const noNotebook = removeItems(tree, [{ type: 'notebook', id: 'work' }]);
    expect(noNotebook.notebooks.map((n) => n.id)).toEqual(['home']);
    expect(noNotebook.sections.map((s) => s.id)).toEqual(['inbox', 'garden']);
    expect(noNotebook.pages).toEqual([]);
  });
});

describe('planning page moves', () => {
  it('names only the outermost of the selected pages', () => {
    const index = buildIndex(sample());
    expect(topmostPages(index, ['a1x', 'a', 'b']).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('refuses to put a page inside itself, before itself or too deep', () => {
    const index = buildIndex(sample());
    const into = (parentPageId: string | null, beforeId: string | null = null) => ({
      sectionId: 'plans',
      parentPageId,
      beforeId,
    });
    expect(checkPagePlace(index, ['a'], into('a1x'), true)).toMatch(/inside itself/);
    expect(checkPagePlace(index, ['a'], into(null, 'a'), true)).toMatch(/before itself/);
    // a has two levels below it, so it can't go under anything.
    expect(checkPagePlace(index, ['a'], into('b'), true)).toMatch(/3 levels/);
    expect(checkPagePlace(index, ['b'], into('a1'), true)).toBeNull();
    expect(checkPagePlace(index, ['b'], { ...into('a'), sectionId: 'garden' }, true)).toMatch(
      /another section/,
    );
    // Copying a page into its own subtree is fine: the copy is a new page.
    expect(checkPagePlace(index, ['b'], into('b'), false)).toBeNull();
  });

  it('moves pages with their subpages, in the order given', () => {
    const tree = sample();
    const plan = planPagesMove(buildIndex(tree), ['c', 'a'], {
      sectionId: 'garden',
      parentPageId: null,
      beforeId: null,
    })!;
    expect(plan.pages!.map((p) => [p.id, p.sectionId])).toEqual([
      ['c', 'garden'],
      ['a', 'garden'],
      ['a1', 'garden'],
      ['a1x', 'garden'],
    ]);
    const next = mergeChanges(tree, plan);
    expect(titles(next, 'garden')).toEqual(['c', 'a', '-a1', '--a1x']);
    expect(titles(next, 'plans')).toEqual(['b']);
  });

  it('indents under the page above and outdents to just after the parent', () => {
    let tree = sample();
    const move = (id: string, place: ReturnType<typeof indentPlace>) => {
      tree = mergeChanges(tree, planPagesMove(buildIndex(tree), [id], place!)!);
    };
    expect(indentPlace(buildIndex(tree), 'a')).toBeNull();
    move('c', indentPlace(buildIndex(tree), 'c'));
    expect(titles(tree, 'plans')).toEqual(['a', '-a1', '--a1x', 'b', '-c']);
    move('a1', outdentPlace(buildIndex(tree), 'a1'));
    expect(titles(tree, 'plans')).toEqual(['a', 'a1', '-a1x', 'b', '-c']);
    expect(outdentPlace(buildIndex(tree), 'a')).toBeNull();
  });

  it('shifts a page among its siblings and stops at the ends', () => {
    let tree = sample();
    const shift = (id: string, by: -1 | 1) => {
      const place = shiftPlace(buildIndex(tree), id, by);
      if (place) tree = mergeChanges(tree, planPagesMove(buildIndex(tree), [id], place)!);
      return place;
    };
    expect(shift('a', -1)).toBeNull();
    shift('a', 1);
    expect(titles(tree, 'plans')).toEqual(['b', 'a', '-a1', '--a1x', 'c']);
    shift('c', -1);
    expect(titles(tree, 'plans')).toEqual(['b', 'c', 'a', '-a1', '--a1x']);
    expect(shift('a', 1)).toBeNull();
  });
});

describe('planning section and group moves', () => {
  it('moves a section into a group, last or before a sibling', () => {
    const tree = sample();
    const plan = planSectionMove(buildIndex(tree), 'plans', {
      notebookId: 'work',
      groupId: 'clients',
      beforeId: 'acme',
    })!;
    const next = buildIndex(mergeChanges(tree, plan));
    expect(next.sectionsIn('work', 'clients').map((s) => s.id)).toEqual(['plans', 'acme']);
    expect(
      planSectionMove(buildIndex(tree), 'inbox', {
        notebookId: 'work',
        groupId: null,
        beforeId: null,
      }),
    ).toBeNull();
  });

  it('keeps groups out of themselves and within four levels', () => {
    const index = buildIndex(sample());
    expect(
      checkGroupMove(index, 'clients', {
        notebookId: 'work',
        parentGroupId: 'archive',
        beforeId: null,
      }),
    ).toMatch(/inside itself/);
    expect(
      checkGroupMove(index, 'archive', { notebookId: 'work', parentGroupId: null, beforeId: null }),
    ).toBeNull();
  });

  it('takes a group’s subgroups and sections to another notebook', () => {
    const tree = sample();
    const plan = planGroupMove(buildIndex(tree), 'clients', {
      notebookId: 'home',
      parentGroupId: null,
      beforeId: null,
    })!;
    const next = buildIndex(mergeChanges(tree, plan));
    expect(next.allSectionsOf('home').map((s) => s.id)).toEqual(['garden', 'acme', 'old']);
    expect(next.allSectionsOf('work').map((s) => s.id)).toEqual(['plans']);
    expect(next.group.get('archive')?.notebookId).toBe('home');
  });

  it('shifts siblings up and down', () => {
    const list = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    expect(shiftBefore(list, 'y', -1)).toEqual({ beforeId: 'x' });
    expect(shiftBefore(list, 'y', 1)).toEqual({ beforeId: null });
    expect(shiftBefore(list, 'x', 1)).toEqual({ beforeId: 'z' });
    expect(shiftBefore(list, 'x', -1)).toBeNull();
    expect(shiftBefore(list, 'z', 1)).toBeNull();
  });
});
