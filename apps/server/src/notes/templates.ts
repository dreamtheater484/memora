import {
  BUILT_IN_TEMPLATES,
  uuidv7,
  type Template,
  type createTemplateSchema,
  type updateTemplateSchema,
} from '@memora/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { templates, type TemplateRow } from '../db/schema';
import { ApiError, notFound } from '../errors';
import type { Orm } from '../repo';

/* Templates (§9.9): the built-in ones, then each user's own, by name. */

/** Templates one user may save. */
export const MAX_TEMPLATES = 200;

const toTemplate = (r: TemplateRow): Template => ({
  id: r.id,
  name: r.name,
  type: r.type,
  content: r.content,
  builtIn: false,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export class TemplatesService {
  constructor(
    private readonly orm: Orm,
    private readonly now: () => number,
  ) {}

  list(owner: string): Template[] {
    const own = this.orm
      .select()
      .from(templates)
      .where(eq(templates.ownerId, owner))
      .orderBy(asc(templates.name), asc(templates.id))
      .all()
      .map(toTemplate);
    return [...BUILT_IN_TEMPLATES, ...own];
  }

  create(owner: string, input: z.output<typeof createTemplateSchema>): Template {
    const [{ n } = { n: 0 }] = this.orm
      .select({ n: count() })
      .from(templates)
      .where(eq(templates.ownerId, owner))
      .all();
    if (n >= MAX_TEMPLATES) {
      throw new ApiError(409, 'conflict', `You can keep at most ${MAX_TEMPLATES} templates.`);
    }
    const now = this.now();
    return toTemplate(
      this.orm
        .insert(templates)
        .values({ id: uuidv7(now), ownerId: owner, ...input, createdAt: now, updatedAt: now })
        .returning()
        .get(),
    );
  }

  update(owner: string, id: string, patch: z.output<typeof updateTemplateSchema>): Template {
    const row = this.orm
      .update(templates)
      .set({ ...patch, updatedAt: this.now() })
      .where(and(eq(templates.id, id), eq(templates.ownerId, owner)))
      .returning()
      .get();
    if (!row) throw notFound('Template not found.');
    return toTemplate(row);
  }

  remove(owner: string, id: string): void {
    const gone = this.orm
      .delete(templates)
      .where(and(eq(templates.id, id), eq(templates.ownerId, owner)))
      .returning({ id: templates.id })
      .get();
    if (!gone) throw notFound('Template not found.');
  }
}
