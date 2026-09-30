#!/usr/bin/env node
/**
 * Fills a Memora with sample notes and a Kanban board, through its API: to try Memora with
 * something in it, and for the documentation's screenshots (Phase 13).
 *
 * A new Memora (it prints a setup code in its log):
 *
 *   node scripts/demo/seed.mjs --url http://localhost:3000 --setup-code 7K3M-Q9WX-D2HT
 *
 * creates the account `demo` with a password it prints (or MEMORA_DEMO_PASSWORD). An account
 * that already exists:
 *
 *   MEMORA_DEMO_PASSWORD=… node scripts/demo/seed.mjs --url https://notes.example.com --user alex
 *
 * Everything it adds is new (notebooks, a project); nothing already there is changed.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { board, markdownPages, notebooks, richPages, template } from './content.mjs';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    'setup-code': { type: 'string' },
    user: { type: 'string', default: 'demo' },
  },
});

const base = args.url.replace(/\/+$/, '');
let cookie = '';
let csrf = '';

async function call(method, path, body) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      origin: new URL(base).origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${data?.error?.message ?? text}`);
  }
  if (data && typeof data.csrfToken === 'string') csrf = data.csrfToken;
  return data;
}

/** A date `days` from today, as the API takes it. */
const day = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function signIn() {
  let password = process.env.MEMORA_DEMO_PASSWORD;
  if (args['setup-code']) {
    const generated = !password;
    password ??= `${randomBytes(9).toString('base64url')}-demo`;
    await call('POST', '/auth/setup', {
      setupCode: args['setup-code'],
      username: args.user,
      displayName: 'Alex Morgan',
      password,
    });
    if (generated) console.log(`Created the account "${args.user}" with the password: ${password}`);
    return;
  }
  if (!password) throw new Error('Set MEMORA_DEMO_PASSWORD to the password of --user.');
  const signedIn = await call('POST', '/auth/login', { username: args.user, password });
  if (signedIn.twoFactorRequired) throw new Error('Turn off two-step verification to seed.');
}

async function seedNotes() {
  const sections = new Map();
  const pages = new Map();
  for (const nb of notebooks) {
    const made = await call('POST', '/notebooks', {
      name: nb.name,
      color: nb.color,
      icon: nb.icon,
    });
    const notebookId = made.notebooks[0].id;
    // A new notebook, and a new group, come with a first section: it becomes the first one
    // listed there.
    const firstSection = new Map([[null, made.sections?.[0]?.id]]);
    const groups = new Map();
    for (const s of nb.sections) {
      let groupId = null;
      if (s.group) {
        groupId = groups.get(s.group);
        if (!groupId) {
          const group = await call('POST', '/groups', { notebookId, name: s.group });
          groupId = group.groups[0].id;
          groups.set(s.group, groupId);
          firstSection.set(groupId, group.sections?.[0]?.id);
        }
      }
      let id = firstSection.get(groupId);
      if (id) {
        await call('PATCH', `/sections/${id}`, { name: s.name, color: s.color });
        firstSection.delete(groupId);
      } else {
        id = (
          await call('POST', '/sections', { notebookId, groupId, name: s.name, color: s.color })
        ).sections[0].id;
      }
      sections.set(s.name, id);
    }
  }
  const add = async (page, type, content) => {
    const sectionId = sections.get(page.section);
    const parentPageId = page.parent ? pages.get(page.parent) : null;
    const made = await call('POST', '/pages', {
      sectionId,
      parentPageId,
      title: page.title,
      type,
      content,
    });
    const id = made.pages[0].id;
    pages.set(page.title, id);
    if (page.tags?.length) await call('PUT', `/pages/${id}/tags`, { names: page.tags });
    if (page.view) await call('PATCH', `/pages/${id}`, { viewMode: page.view });
    return id;
  };
  for (const page of markdownPages(day)) await add(page, 'markdown', page.content);
  for (const page of richPages(day)) await add(page, 'rich', JSON.stringify(page.content));
  await call('POST', '/templates', template);
  return { sections, pages };
}

async function seedBoard(pages) {
  const { project, labels, columns, cards } = board(day);
  const made = await call('POST', '/projects', project);
  const projectId = made.project.id;
  const boardId = made.board.id;
  const labelIds = new Map();
  for (const label of labels) {
    labelIds.set(label.name, (await call('POST', `/projects/${projectId}/labels`, label)).id);
  }
  await call('PATCH', `/boards/${boardId}`, { lanes: 'priority' });
  const data = await call('GET', `/boards/${boardId}`);
  const columnIds = new Map();
  for (const [index, column] of columns.entries()) {
    const existing = data.columns[index];
    const id = existing
      ? existing.id
      : (await call('POST', `/boards/${boardId}/columns`, { name: column.name })).id;
    await call('PATCH', `/columns/${id}`, column);
    columnIds.set(column.name, id);
  }
  for (const extra of data.columns.slice(columns.length)) {
    await call('DELETE', `/columns/${extra.id}`);
  }
  for (const card of cards) {
    const made = await call('POST', '/cards', {
      columnId: columnIds.get(card.column),
      title: card.title,
    });
    await call('PATCH', `/cards/${made.id}`, {
      ...card.update,
      labelIds: (card.labels ?? []).map((name) => labelIds.get(name)),
    });
    if (card.checklist) {
      // These answer the whole card, with its checklists.
      const withList = await call('POST', `/cards/${made.id}/checklists`, {
        title: card.checklist.title,
      });
      const listId = withList.checklists.at(-1).id;
      for (const [text, done] of card.checklist.items) {
        const detail = await call('POST', `/checklists/${listId}/items`, { text });
        const item = detail.checklists.find((c) => c.id === listId).items.at(-1);
        if (done) await call('PATCH', `/checklist-items/${item.id}`, { done: true });
      }
    }
    for (const body of card.comments ?? [])
      await call('POST', `/cards/${made.id}/comments`, { body });
    for (const title of card.notes ?? []) {
      await call('PUT', `/cards/${made.id}/pages/${pages.get(title)}`);
    }
  }
  return boardId;
}

async function main() {
  await signIn();
  const { pages } = await seedNotes();
  const boardId = await seedBoard(pages);
  const settings = await call('GET', '/settings');
  await call('PATCH', '/settings', {
    ui: {
      ...settings.ui,
      favorites: [
        { type: 'page', id: pages.get('Website relaunch plan') },
        { type: 'page', id: pages.get('Sourdough bread') },
      ],
    },
  });
  console.log(`Seeded ${pages.size} pages and a board: ${base}/b/${boardId}`);
}

main().catch((error) => {
  console.error(`seed: ${error.message}`);
  process.exitCode = 1;
});
