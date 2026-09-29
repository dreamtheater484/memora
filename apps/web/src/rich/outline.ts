import { parseRich, richHeadings, richToText, type RichNode } from '@memora/shared';
import { statsOf, type Heading, type TextStats } from '../markdown/outline';

/*
 * The outline and word count of a rich page (§9.3, §9.4). A heading's `line` is its place
 * among the page's headings, which is how a rich page jumps to it.
 */

export function richOutline(content: string | RichNode | undefined): {
  headings: Heading[];
  stats: TextStats;
} {
  const doc = typeof content === 'string' ? parseRich(content) : content;
  if (!doc) return { headings: [], stats: statsOf('') };
  return {
    headings: richHeadings(doc)
      .map((h, i) => ({ level: h.level, text: h.text, line: i }))
      .filter((h) => h.text),
    stats: statsOf(richToText(doc)),
  };
}
