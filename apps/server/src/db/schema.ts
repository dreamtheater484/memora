import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Instance-level facts: the instance id, the version that created the database, … */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
