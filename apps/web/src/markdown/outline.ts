import { markdownToText } from '@memora/shared';

/*
 * The outline panel and the page's word count (§9.3). Read straight from the source, without
 * rendering, so they stay cheap on long pages: headings outside code blocks, ATX (`## x`) and
 * setext (underlined) alike.
 */

export interface Heading {
  level: number;
  text: string;
  /** 1-based source line. */
  line: number;
}

const clean = (text: string) =>
  markdownToText(text)
    .replace(/\s+#+\s*$/, '')
    .trim();

export function headingsOf(markdown: string): Heading[] {
  const lines = markdown.split('\n');
  const headings: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (opener && opener[1]![0] === fence[0] && opener[1]!.length >= fence.length) fence = null;
      return;
    }
    if (opener) {
      fence = opener[1]!;
      return;
    }
    const atx = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (atx) {
      const text = clean(atx[2]!);
      if (text) headings.push({ level: atx[1]!.length, text, line: i + 1 });
      return;
    }
    const next = lines[i + 1];
    if (
      next !== undefined &&
      line.trim() &&
      /^\s{0,3}(=+|-+)\s*$/.test(next) &&
      !/^\s*([-*+]|\d+[.)])\s/.test(line) &&
      !line.includes('|')
    ) {
      const level = next.trim().startsWith('=') ? 1 : 2;
      // A lone `---` under a paragraph line is a heading only in the setext sense; fine.
      const text = clean(line);
      if (text) headings.push({ level, text, line: i + 1 });
    }
  });
  return headings;
}

export interface TextStats {
  words: number;
  characters: number;
  /** Minutes, at about 230 words a minute; at least one for any text. */
  minutes: number;
}

export function statsOf(markdown: string): TextStats {
  const text = markdownToText(markdown.replace(/^---\n[\s\S]*?\n---\n/, ''));
  // CJK characters count as words of their own; everything else splits on spaces.
  const cjk = text.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0;
  const words =
    text
      .replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ')
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length + cjk;
  const characters = text.replace(/\s/g, '').length;
  return { words, characters, minutes: words ? Math.max(1, Math.round(words / 230)) : 0 };
}
