import { parseRich, richToMarkdown, type MarkdownResult, type RichNode } from '@memora/shared';
import { generateJSON } from '@tiptap/core';
import type { Element, ElementContent, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { SKIP, visit } from 'unist-util-visit';
import { toHast } from '../markdown/pipeline';
import { richExtensions } from './schema';

/*
 * Converting a page between Markdown and rich text (§9.4). Markdown → rich goes through the
 * preview's pipeline, so the rich page shows what the preview showed: the rendered HTML is
 * adapted to the rich schema's HTML and read by it. Rich → Markdown is the shared writer, with
 * its report of what Markdown can't express.
 */

const hasClass = (node: Element, name: string) => {
  const value = node.properties.className;
  return Array.isArray(value) && value.includes(name);
};

const textOf = (node: ElementContent): string =>
  node.type === 'text'
    ? node.value
    : node.type === 'element'
      ? node.children.map(textOf).join('')
      : '';

const element = (
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[] = [],
): Element => ({ type: 'element', tagName, properties, children });

/** Rewrites the preview's HTML into what the rich schema reads. */
function adapt(tree: Root) {
  visit(tree, 'element', (node: Element, index, parent) => {
    if (!parent || index === undefined) return;
    // Card keys are plain text in rich pages (they are linked as they are shown).
    if (node.tagName === 'a' && hasClass(node, 'card-link')) {
      parent.children.splice(index, 1, ...node.children);
      return [SKIP, index];
    }
    // Alerts become callouts, without their generated title.
    if (node.tagName === 'div' && hasClass(node, 'markdown-alert')) {
      const kind = /markdown-alert-(\w+)/.exec(
        (node.properties.className as string[]).join(' '),
      )?.[1];
      node.properties = { dataType: 'callout', dataKind: kind ?? 'note' };
      node.children = node.children.filter(
        (child) => !(child.type === 'element' && hasClass(child, 'markdown-alert-title')),
      );
      return;
    }
    // Maths.
    if (node.tagName === 'code' && hasClass(node, 'math-inline')) {
      parent.children[index] = element('span', {
        dataType: 'inline-math',
        dataLatex: textOf(node),
      });
      return SKIP;
    }
    if (node.tagName === 'pre') {
      const code = node.children.find(
        (c): c is Element => c.type === 'element' && c.tagName === 'code',
      );
      if (code && hasClass(code, 'math-display')) {
        parent.children[index] = element('div', {
          dataType: 'block-math',
          dataLatex: textOf(code).trim(),
        });
        return SKIP;
      }
      // The fence's closing line break isn't part of the code.
      const last = code?.children.at(-1);
      if (last?.type === 'text') last.value = last.value.replace(/\n$/, '');
    }
    // Task lists.
    if (node.tagName === 'ul' && hasClass(node, 'contains-task-list')) {
      node.properties = { dataType: 'taskList' };
      for (const item of node.children) {
        if (item.type !== 'element' || item.tagName !== 'li') continue;
        let checked = false;
        visit(item, 'element', (child: Element, i, up) => {
          if (child.tagName === 'ul' || child.tagName === 'ol') return SKIP;
          if (child.tagName === 'input' && up && i !== undefined) {
            checked = child.properties.checked === true;
            up.children.splice(i, 1);
            return [SKIP, i];
          }
        });
        item.properties = { dataType: 'taskItem', dataChecked: String(checked) };
      }
      return;
    }
    // Column alignment moves onto the cell's paragraph.
    if ((node.tagName === 'th' || node.tagName === 'td') && node.properties.align) {
      const align = String(node.properties.align);
      delete node.properties.align;
      node.children = [element('p', { style: `text-align: ${align}` }, node.children)];
    }
  });
}

/** A Markdown page as a rich document. Nothing is lost (§9.4). */
export function markdownToRich(markdown: string): RichNode {
  const tree = toHast(markdown);
  adapt(tree);
  return generateJSON(toHtml(tree), richExtensions()) as RichNode;
}

/** A rich page as Markdown, with what couldn't be kept. */
export function richToMarkdownPage(content: string): MarkdownResult {
  const doc = parseRich(content);
  if (!doc) return { markdown: '', lost: [] };
  return richToMarkdown(doc);
}
