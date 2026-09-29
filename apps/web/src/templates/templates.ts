import {
  BUILT_IN_TEMPLATES,
  fillTemplate,
  parseRich,
  richToMarkdown,
  type PageType,
  type Template,
} from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { templatesQuery } from '../search/api';
import { useShell } from '../shell/store';

/*
 * Templates (§9.9) as the app uses them: the list (the built-in ones without a connection),
 * a template's content for a page of either type, and the picker behind `/template`.
 */

export function useTemplates(): Template[] {
  return useQuery(templatesQuery).data ?? (BUILT_IN_TEMPLATES as Template[]);
}

/** A template's content, filled in, for a page of `type` (converted when they differ). */
export async function contentFor(
  template: Template,
  type: PageType,
  title: string,
): Promise<string> {
  const filled = fillTemplate(template.type, template.content, { title, now: new Date() });
  if (template.type === type) return filled;
  if (type === 'markdown') {
    const doc = parseRich(filled);
    return doc ? richToMarkdown(doc).markdown : '';
  }
  const { markdownToRich } = await import('../rich/convert');
  return JSON.stringify(markdownToRich(filled));
}

/** Opens the template picker; `onPick` gets the chosen one. */
export function pickTemplate(onPick: (template: Template) => void): void {
  useShell.getState().openDialog({ kind: 'insert-template', onPick });
}
