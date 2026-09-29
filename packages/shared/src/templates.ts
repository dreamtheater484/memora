import { z } from 'zod';
import { MAX_INITIAL_CONTENT, PAGE_TYPES, nameSchema, type PageType } from './notes';

/*
 * Templates (§9.9): a few built in, and any page saved as one. A new page can start from a
 * template (the "New page" menu, a section's default, or `/template` in the editors), with
 * `{{title}}`, `{{date}}` and `{{time}}` filled in.
 */

export interface Template {
  /** `builtin:<name>` for the built-in ones. */
  id: string;
  name: string;
  type: PageType;
  content: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Largest template: what a new page may start with. */
export const MAX_TEMPLATE_LENGTH = MAX_INITIAL_CONTENT;

/** `POST /templates`: save a page's content as a template. */
export const createTemplateSchema = z.object({
  name: nameSchema,
  type: z.enum(PAGE_TYPES),
  content: z.string().max(MAX_TEMPLATE_LENGTH),
});
export type CreateTemplateRequest = z.input<typeof createTemplateSchema>;

/** `PATCH /templates/:id` */
export const updateTemplateSchema = z
  .object({ name: nameSchema, content: z.string().max(MAX_TEMPLATE_LENGTH) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateTemplateRequest = z.input<typeof updateTemplateSchema>;

const builtIn = (id: string, name: string, content: string): Template => ({
  id: `builtin:${id}`,
  name,
  type: 'markdown',
  content,
  builtIn: true,
  createdAt: 0,
  updatedAt: 0,
});

export const BUILT_IN_TEMPLATES: readonly Template[] = [
  builtIn(
    'meeting',
    'Meeting notes',
    `**Date:** {{date}}\n**Attendees:** \n\n## Agenda\n\n1. \n\n## Notes\n\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n`,
  ),
  builtIn(
    'todo',
    'To-do list',
    `## Today\n\n- [ ] \n\n## This week\n\n- [ ] \n\n## Later\n\n- [ ] \n`,
  ),
  builtIn(
    'brief',
    'Project brief',
    `## Goal\n\nWhat this project achieves, in a sentence or two.\n\n## Background\n\n\n\n## Scope\n\n**In:**\n\n- \n\n**Out:**\n\n- \n\n## Milestones\n\n| Milestone | Date | Owner |\n| --------- | ---- | ----- |\n|           |      |       |\n\n## Risks\n\n- \n`,
  ),
  builtIn(
    'journal',
    'Daily journal',
    `## {{date}}\n\n**Grateful for:** \n\n**Today's focus:** \n\n## Notes\n\n\n\n## Tomorrow\n\n- [ ] \n`,
  ),
  builtIn(
    'decision',
    'Decision record',
    `## Context\n\nWhat is the issue that we're seeing that motivates this decision?\n\n## Decision\n\nWhat we decided, and who decided it ({{date}}).\n\n## Options considered\n\n1. \n\n## Consequences\n\nWhat becomes easier or harder because of this decision?\n`,
  ),
];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The template's content with `{{title}}`, `{{date}}` (YYYY-MM-DD) and `{{time}}` (HH:MM)
 * filled in, in local time. Rich content is JSON, so values are escaped for it.
 */
export function fillTemplate(
  type: PageType,
  content: string,
  { title, now }: { title: string; now: Date },
): string {
  const values: Record<string, string> = {
    title,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  return content.replace(/\{\{\s*(title|date|time)\s*\}\}/g, (_, key: string) => {
    const value = values[key]!;
    return type === 'rich' ? JSON.stringify(value).slice(1, -1) : value;
  });
}
