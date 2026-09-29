import { describe, expect, it } from 'vitest';
import { merge3, textChange } from './merge';

const base = '# Trip\n\nPack the tent and the stove.\n\n- Tickets\n- Maps\n';

describe('merge3', () => {
  it('takes whichever side changed when only one did', () => {
    expect(merge3(base, base, 'mine')).toEqual({ ok: true, text: 'mine' });
    expect(merge3(base, 'theirs', base)).toEqual({ ok: true, text: 'theirs' });
    expect(merge3(base, 'same', 'same')).toEqual({ ok: true, text: 'same' });
  });

  it('combines edits to different lines', () => {
    const theirs = base.replace('# Trip', '# Trip to the coast');
    const mine = base.replace('- Maps', '- Maps\n- Sunscreen');
    expect(merge3(base, theirs, mine)).toEqual({
      ok: true,
      text: '# Trip to the coast\n\nPack the tent and the stove.\n\n- Tickets\n- Maps\n- Sunscreen\n',
    });
  });

  it('combines edits to different words of one paragraph', () => {
    const theirs = base.replace('the tent', 'the big tent');
    const mine = base.replace('the stove.', 'the camping stove.');
    const merged = merge3(base, theirs, mine);
    expect(merged).toEqual({
      ok: true,
      text: base.replace(
        'Pack the tent and the stove.',
        'Pack the big tent and the camping stove.',
      ),
    });
  });

  it('keeps whitespace and line breaks exactly', () => {
    const b = 'a  b\n\n\tc\n';
    expect(merge3(b, 'a  B\n\n\tc\n', 'a  b\n\n\tC\n')).toEqual({
      ok: true,
      text: 'a  B\n\n\tC\n',
    });
  });

  it('refuses overlapping edits', () => {
    const theirs = base.replace('the tent', 'the hammock');
    const mine = base.replace('the tent', 'the bivvy');
    expect(merge3(base, theirs, mine)).toEqual({ ok: false });
  });

  it('refuses two different additions at the same place', () => {
    expect(merge3('a\n', 'a\nb\n', 'a\nc\n')).toEqual({ ok: false });
  });

  it('accepts the same change made on both sides', () => {
    const both = base.replace('Maps', 'Maps and a compass');
    const mine = both.replace('# Trip', '# Trip!');
    expect(merge3(base, both, mine)).toEqual({ ok: true, text: mine });
  });
});

describe('textChange', () => {
  it('replaces only what differs', () => {
    expect(textChange('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    });
    expect(textChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' });
    expect(textChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
    expect(textChange('', 'new')).toEqual({ from: 0, to: 0, insert: 'new' });
  });
});
