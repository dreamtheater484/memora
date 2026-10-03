/*
 * Fenced code inside Markdown containers (§9.3): in a list item or a quote (a callout too),
 * every line of a fence starts with what its container needs there, the item's indentation
 * and the quotes' `>` markers, and then the fence's own indentation. The code is read without
 * that prefix and written back with it, so the page's structure never changes.
 */

/** The width of a tab at `column`: to the next multiple of four, as Markdown counts. */
const tabWidth = (column: number) => 4 - (column % 4);

/**
 * What each line of a fence's code starts with, from what its opening line has before the
 * fence: a list marker becomes spaces (its item's indentation), a `>` stays, with a space
 * after it so that code starting with a space keeps it. Tabs become spaces.
 */
export function fencePrefix(opening: string): string {
  let out = '';
  for (const c of opening) {
    if (c === '\t') out += ' '.repeat(tabWidth(out.length));
    else out += c === '>' ? c : ' ';
  }
  return out.replace(/>(?! )/g, '> ');
}

/** How many columns `text` takes. */
export function columnsOf(text: string): number {
  let col = 0;
  for (const c of text) col += c === '\t' ? tabWidth(col) : 1;
  return col;
}

/**
 * A line of a fence's code as Markdown reads it: without its prefix (see fencePrefix). A `>`
 * may have up to three spaces before it and one after it, and indentation is taken only as
 * far as the line has it, the way a fence's own indentation is.
 */
export function stripFencePrefix(line: string, prefix: string): string {
  let at = 0;
  let col = 0;
  // Columns of a tab that was only partly taken: they stay, as spaces.
  let spare = 0;
  let i = 0;
  while (i < prefix.length) {
    if (prefix[i] === '>') {
      let j = at;
      let room = 3 - spare;
      while (line[j] === ' ' && room > 0) {
        j += 1;
        room -= 1;
      }
      if (line[j] !== '>') break;
      col += j - at + 1;
      at = j + 1;
      spare = 0;
      // The space after a `>` belongs to the marker, whether the line has it or not.
      if (line[at] === ' ') {
        at += 1;
        col += 1;
      } else if (line[at] === '\t') {
        spare = tabWidth(col) - 1;
        col += spare + 1;
        at += 1;
      }
      i += prefix[i + 1] === ' ' ? 2 : 1;
      continue;
    }
    // Indentation: as many of these columns as the line has.
    let need = 0;
    while (i < prefix.length && prefix[i] !== '>') {
      need += 1;
      i += 1;
    }
    const taken = Math.min(spare, need);
    spare -= taken;
    need -= taken;
    while (need > 0 && (line[at] === ' ' || line[at] === '\t')) {
      const w = line[at] === '\t' ? tabWidth(col) : 1;
      at += 1;
      col += w;
      spare = Math.max(0, w - need);
      need = Math.max(0, need - w);
    }
  }
  return ' '.repeat(spare) + line.slice(at);
}

/** Code as the lines of a fence with `prefix`; an empty line keeps just its markers. */
export function prefixFenceLines(code: string, prefix: string): string {
  return code
    .split('\n')
    .map((line) => (line === '' ? prefix.trimEnd() : prefix + line))
    .join('\n');
}
