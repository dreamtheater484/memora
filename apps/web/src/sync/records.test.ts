import { describe, expect, it } from 'vitest';
import {
  absorb,
  fromServer,
  keepMine,
  keepTheirs,
  rebase,
  restore,
  saved,
  settle,
  write,
  type PageRecord,
} from './records';

const base = 'Pack the tent.\n\n- Tickets\n';
const server = (revision: number, content: string) =>
  ({ revision, content, type: 'markdown' }) as const;

/** A record at revision 3 with `content` typed on top of `base`. */
const edited = (content: string): PageRecord =>
  settle({ ...fromServer('p1', server(3, base), 0), content, writeId: 'w-local', writer: 'tab' });

describe('a page record', () => {
  it('is dirty exactly while something waits to be sent', () => {
    expect(fromServer('p1', server(1, base), 0).dirty).toBe(0);
    expect(edited(`${base}- Maps\n`).dirty).toBe(1);
    expect(edited(base).dirty).toBe(0);
  });
});

describe('absorb (a newer server version arrives)', () => {
  it('follows the server when nothing was changed here', () => {
    const record = fromServer('p1', server(3, base), 0);
    const next = absorb(record, server(4, 'New text'))!;
    expect(next).toMatchObject({ revision: 4, base: 'New text', content: 'New text', dirty: 0 });
    expect(next.writeId).not.toBe(record.writeId);
  });

  it('ignores versions it already has', () => {
    expect(absorb(fromServer('p1', server(3, base), 0), server(3, base))).toBeUndefined();
    expect(absorb(fromServer('p1', server(3, base), 0), server(2, 'Old'))).toBeUndefined();
  });

  it('merges edits that don’t overlap, and the merge waits to be sent', () => {
    const theirs = base.replace('the tent', 'the big tent');
    const next = absorb(edited(`${base}- Maps\n`), server(4, theirs))!;
    expect(next).toMatchObject({
      revision: 4,
      base: theirs,
      content: 'Pack the big tent.\n\n- Tickets\n- Maps\n',
      dirty: 1,
    });
    expect(next.conflict).toBeUndefined();
  });

  it('turns overlapping edits into a conflict that keeps both', () => {
    const mine = edited(base.replace('the tent', 'the hammock'));
    const next = absorb(mine, server(4, base.replace('the tent', 'the bivvy')))!;
    expect(next.content).toBe(mine.content);
    expect(next.revision).toBe(3);
    expect(next.conflict).toEqual({
      revision: 4,
      content: 'Pack the bivvy.\n\n- Tickets\n',
      kept: null,
    });
    expect(next.dirty).toBe(1);
  });

  it('doesn’t merge rich pages', () => {
    const rich = { ...edited('{"a":2}'), type: 'rich' as const, base: '{"a":1}' };
    const next = absorb(rich, { revision: 4, content: '{"a":3}', type: 'rich' })!;
    expect(next.conflict).toMatchObject({ revision: 4, content: '{"a":3}' });
  });

  it('settles the conflict when the server comes to have the same text', () => {
    const conflicted = absorb(edited('Mine'), server(4, 'Theirs'))!;
    expect(absorb(conflicted, server(5, 'Newer theirs'))!.conflict).toMatchObject({
      revision: 5,
      content: 'Newer theirs',
    });
    const settled = absorb(conflicted, server(5, 'Mine'))!;
    expect(settled).toMatchObject({ revision: 5, base: 'Mine', content: 'Mine', dirty: 0 });
    expect(settled.conflict).toBeUndefined();
  });

  it('takes the server’s text when it is the same as the local one', () => {
    expect(absorb(edited('Same'), server(4, 'Same'))).toMatchObject({ revision: 4, dirty: 0 });
  });
});

describe('saved (the server took a save)', () => {
  it('moves the base to what was sent', () => {
    const record = edited(`${base}- Maps\n`);
    const sent = { writeId: record.writeId, content: record.content, revision: 3 };
    expect(saved(record, sent, 4)).toMatchObject({ revision: 4, base: record.content, dirty: 0 });
  });

  it('keeps what was typed while the save was on its way', () => {
    const record = edited(`${base}- Maps\n`);
    const sent = { writeId: record.writeId, content: record.content, revision: 3 };
    const later = { ...record, content: `${record.content}- Sunscreen\n`, writeId: 'w2' };
    expect(saved(later, sent, 4)).toMatchObject({
      revision: 4,
      base: record.content,
      content: later.content,
      dirty: 1,
    });
  });

  it('leaves a record that meanwhile took a newer server version', () => {
    const record = edited('Mine');
    const sent = { writeId: record.writeId, content: 'Mine', revision: 2 };
    expect(saved(record, sent, 3)).toBeUndefined();
  });

  it('ends a resolving save only when the resolution itself was sent', () => {
    const resolving = { ...edited('Mine'), resolving: true };
    const sent = { writeId: resolving.writeId, content: 'Mine', revision: 3 };
    expect(saved(resolving, sent, 4)!.resolving).toBeUndefined();
    const typedOn = { ...resolving, writeId: 'later', content: 'Mine!' };
    expect(saved(typedOn, sent, 4)!.resolving).toBe(true);
  });
});

describe('write (a tab stores its text)', () => {
  it('replaces the text it grew from', () => {
    const record = fromServer('p1', server(3, base), 0);
    const { record: next, displaced } = write(record, record, 'Mine', 'tab-a', 5);
    expect(next).toMatchObject({ content: 'Mine', writer: 'tab-a', touchedAt: 5, dirty: 1 });
    expect(displaced).toBeUndefined();
  });

  it('merges with text another tab wrote meanwhile', () => {
    const start = fromServer('p1', server(3, 'one\ntwo\nthree\n'), 0);
    const other = { ...start, content: 'ONE\ntwo\nthree\n', writeId: 'other' };
    const { record } = write(other, start, 'one\ntwo\nTHREE\n', 'tab-a', 5);
    expect(record.content).toBe('ONE\ntwo\nTHREE\n');
  });

  it('wins when the texts can’t be merged, handing the other back to keep', () => {
    const start = fromServer('p1', server(3, 'one'), 0);
    const other = { ...start, content: 'two', writeId: 'other' };
    const result = write(other, start, 'three', 'tab-a', 5);
    expect(result.record.content).toBe('three');
    expect(result.displaced).toBe('two');
  });

  it('leaves another tab’s text when this tab has nothing new', () => {
    const start = fromServer('p1', server(3, 'one'), 0);
    const other = { ...start, content: 'two', writeId: 'other' };
    expect(write(other, start, 'one', 'tab-a', 5).record.content).toBe('two');
  });
});

describe('settling a conflict', () => {
  const conflicted = absorb(edited('Mine'), server(4, 'Theirs'))!;

  it('keep mine: this text replaces the server’s, which the server keeps', () => {
    expect(keepMine(conflicted)).toMatchObject({
      revision: 4,
      base: 'Theirs',
      content: 'Mine',
      resolving: true,
      dirty: 1,
    });
    expect(keepMine(conflicted, 'Combined').content).toBe('Combined');
  });

  it('keep theirs: the server’s version stays', () => {
    const next = keepTheirs(conflicted);
    expect(next).toMatchObject({ revision: 4, base: 'Theirs', content: 'Theirs', dirty: 0 });
    expect(next.conflict).toBeUndefined();
  });
});

describe('restore (text a closed tab couldn’t store)', () => {
  const unstored = (known: { writeId: string; content: string }) =>
    ({ text: `${base}- Maps\n`, known, type: 'markdown', revision: 3, base }) as const;

  it('goes on top of the write it grew from', () => {
    const record = fromServer('p1', server(3, base), 0);
    expect(restore('p1', record, unstored(record), 'tab', 5).record).toMatchObject({
      content: `${base}- Maps\n`,
      dirty: 1,
    });
  });

  it('merges with what was stored since', () => {
    const start = fromServer('p1', server(3, base), 0);
    const since = { ...start, content: base.replace('the tent', 'the big tent'), writeId: 'w2' };
    expect(restore('p1', since, unstored(start), 'tab', 5).record.content).toBe(
      'Pack the big tent.\n\n- Tickets\n- Maps\n',
    );
  });

  it('makes the record again when the store lost it', () => {
    const { record } = restore(
      'p1',
      undefined,
      unstored({ writeId: 'x', content: base }),
      'tab',
      5,
    );
    expect(record).toMatchObject({ id: 'p1', revision: 3, base, content: `${base}- Maps\n` });
    expect(record.dirty).toBe(1);
  });
});

it('rebase keeps the text on top of a server that went back', () => {
  expect(rebase(edited('Mine'), server(1, 'Restored'))).toMatchObject({
    revision: 1,
    base: 'Restored',
    content: 'Mine',
    dirty: 1,
  });
});

describe('rich pages and conversions', () => {
  const doc = (text: string) =>
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
  const rich = (revision: number, content: string) =>
    ({ revision, content, type: 'rich' }) as const;

  it('never merges two edits of a rich page as text', () => {
    const record = settle({
      ...fromServer('p1', rich(3, doc('Pack the tent and the stove')), 0),
      content: doc('Pack the big tent and the stove'),
    });
    const next = absorb(record, rich(4, doc('Pack the tent and the old stove')))!;
    expect(next.conflict).toMatchObject({ revision: 4, kept: null });
    expect(next.conflict?.type).toBeUndefined();
    expect(next.content).toBe(doc('Pack the big tent and the stove'));
  });

  it('takes a page converted elsewhere when nothing was changed here', () => {
    const next = absorb(fromServer('p1', server(3, base), 0), rich(4, doc('Pack')))!;
    expect(next).toMatchObject({ type: 'rich', content: doc('Pack'), dirty: 0 });
  });

  it('keeps only theirs when the page was converted while it was edited here', () => {
    const next = absorb(edited(`${base}- Maps\n`), rich(4, doc('Pack')))!;
    expect(next.conflict).toMatchObject({ revision: 4, type: 'rich' });
    expect(keepMine(next)).toBe(next);
    expect(keepTheirs(next)).toMatchObject({
      type: 'rich',
      content: doc('Pack'),
      base: doc('Pack'),
      revision: 4,
      conflict: undefined,
    });
  });
});
