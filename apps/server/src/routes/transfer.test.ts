import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  uuidv7,
  type BoardData,
  type CardDetail,
  type ImportReport,
  type Projects,
  type Job,
  type Page,
  type PageVersionMeta,
  type Tree,
  type TreeChanges,
} from '@memora/shared';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { afterEach, describe, expect, it } from 'vitest';
import { pngOf } from '../test/images';
import { createTestApp, type Client, type TestApp } from '../test/harness';
import { PASSWORD_HEADER } from './transfer';

/* Import and export (§9.10): round trips, encryption, merging, Markdown, checks and limits. */

const apps: TestApp[] = [];
afterEach(async () => {
  for (const t of apps.splice(0)) await t.close();
});

async function start(env: Record<string, string> = {}): Promise<{ t: TestApp; me: Client }> {
  const t = await createTestApp(env);
  apps.push(t);
  return { t, me: await t.setupAdmin('alex') };
}

async function waitFor(me: Client, id: string): Promise<Job> {
  for (let i = 0; i < 400; i += 1) {
    const job = (await me.get(`/api/v1/jobs/${id}`)).json() as Job;
    if (job.state === 'done' || job.state === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job never finished');
}

async function exported(me: Client, body: object): Promise<{ job: Job; file: Buffer }> {
  const res = await me.post('/api/v1/exports', body);
  expect(res.statusCode, res.body).toBe(202);
  const job = await waitFor(me, (res.json() as Job).id);
  expect(job.error).toBeNull();
  const download = await me.get(`/api/v1/jobs/${job.id}/download`);
  expect(download.statusCode).toBe(200);
  return { job, file: download.rawPayload };
}

async function imported(me: Client, file: Buffer, query: string, password?: string): Promise<Job> {
  const res = await me.post(`/api/v1/imports?${query}`, file, {
    headers: {
      'content-type': 'application/octet-stream',
      ...(password ? { [PASSWORD_HEADER]: password } : {}),
    },
  });
  expect(res.statusCode, res.body).toBe(202);
  return waitFor(me, (res.json() as Job).id);
}

/** The titles of the pages that link to a page. */
async function backlinks(me: Client, id: string): Promise<string[]> {
  const tree = (await me.get('/api/v1/tree')).json() as Tree;
  const { pages } = (await me.get(`/api/v1/pages/${id}/backlinks`)).json() as { pages: string[] };
  return pages.map((source) => tree.pages.find((p) => p.id === source)!.title);
}

const rich = (...content: object[]) => JSON.stringify({ type: 'doc', content });
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** A bit of everything: groups in groups, subpages, both page types, tags, links, files, history. */
async function fill(me: Client) {
  const tree = (await me.get('/api/v1/tree')).json() as Tree;
  const nb = (
    await me.post('/api/v1/notebooks', { name: 'Work', color: 'green', icon: 'briefcase' })
  ).json() as TreeChanges;
  const notebookId = nb.notebooks![0]!.id;
  const firstSection = nb.sections![0]!.id;
  const outer = (await me.post('/api/v1/groups', { notebookId, name: 'Clients' })).json().groups[0]
    .id as string;
  const inner = (
    await me.post('/api/v1/groups', { notebookId, parentGroupId: outer, name: 'Europe' })
  ).json().groups[0].id as string;
  const section = (
    await me.post('/api/v1/sections', { notebookId, groupId: inner, name: 'Acme', color: 'coral' })
  ).json().sections[0].id as string;

  const imageId = uuidv7();
  await me.put(`/api/v1/assets/${imageId}?name=chart.png`, pngOf(4, 3), {
    headers: { 'content-type': 'image/png' },
  });
  const page = async (body: object) =>
    ((await me.post('/api/v1/pages', body)).json() as TreeChanges).pages![0]!.id;
  const plans = await page({
    sectionId: section,
    title: 'Plans',
    content: `# Plans\n\nSee [[Meeting notes]].\n\n![Chart](asset:${imageId})\n`,
  });
  await page({
    sectionId: section,
    parentPageId: plans,
    title: 'Meeting notes',
    content: 'Agenda',
  });
  await page({
    sectionId: firstSection,
    title: 'Rich page',
    type: 'rich',
    content: rich(paragraph('Hello'), { type: 'image', attrs: { src: `asset:${imageId}` } }),
  });
  const inboxPage = await page({ sectionId: tree.inboxId, title: 'Quick note', content: 'Milk' });
  await me.put(`/api/v1/pages/${plans}/tags`, { names: ['Urgent', 'client'] });
  const tag = (await me.get('/api/v1/tree'))
    .json()
    .tags.find((t: { name: string }) => t.name === 'Urgent');
  await me.patch(`/api/v1/tags/${tag.id}`, { color: 'violet' });
  // History: an edit and a named version.
  const current = (await me.get(`/api/v1/pages/${inboxPage}`)).json() as Page;
  await me.put(`/api/v1/pages/${inboxPage}/content`, {
    baseRevision: current.revision,
    content: 'Milk and bread',
  });
  await me.post(`/api/v1/pages/${inboxPage}/versions`, { reason: 'manual', name: 'Shopping' });
  await me.post('/api/v1/templates', {
    name: 'Standup',
    type: 'markdown',
    content: '## Yesterday',
  });
  // A Kanban project whose cards hold a bit of everything.
  const made = (
    await me.post('/api/v1/projects', {
      name: 'Launch',
      key: 'LCH',
      color: 'violet',
      template: 'extended',
    })
  ).json();
  const board = (await me.get(`/api/v1/boards/${made.board.id}`)).json() as BoardData;
  const label = (
    await me.post(`/api/v1/projects/${made.project.id}/labels`, { name: 'Copy', color: 'amber' })
  ).json();
  await me.patch(`/api/v1/columns/${board.columns[2]!.id}`, { wipLimit: 3, wipStrict: true });
  await me.post(`/api/v1/boards/${made.board.id}/lanes`, { name: 'Web' });
  const card = (
    await me.post('/api/v1/cards', { columnId: board.columns[1]!.id, title: 'Hero text' })
  ).json();
  await me.post('/api/v1/cards', { columnId: board.columns[4]!.id, title: 'Kick-off' });
  await me.patch(`/api/v1/cards/${card.id}`, {
    labelIds: [label.id],
    priority: 'high',
    dueDate: '2026-02-01',
    description: `Tone: calm.\n\n![Mood](asset:${imageId})`,
  });
  const detail = (await me.post(`/api/v1/cards/${card.id}/checklists`, { title: 'Steps' })).json();
  await me.post(`/api/v1/checklists/${detail.checklists[0].id}/items`, { text: 'Draft' });
  await me.post(`/api/v1/cards/${card.id}/comments`, { body: 'First pass done' });
  await me.put(`/api/v1/cards/${card.id}/pages/${plans}`);
  await me.post(`/api/v1/cards/${card.id}/attachments`, { assetId: imageId });
  return { notebookId, section, plans, imageId };
}

/** Everything a user sees, without ids: what a round trip must keep. */
async function snapshot(me: Client) {
  const tree = (await me.get('/api/v1/tree')).json() as Tree;
  const tags = new Map((tree.tags ?? []).map((t) => [t.id, `${t.name}:${t.color ?? ''}`]));
  const files = new Map<string, string>();
  const withFiles = async (content: string) => {
    for (const [, id] of content.matchAll(/asset:([0-9a-f-]{36})/g)) {
      if (!files.has(id!)) {
        const res = await me.get(`/api/v1/assets/${id}`);
        files.set(id!, `${res.headers['content-type']}:${res.rawPayload.toString('base64')}`);
      }
    }
    return content.replace(/asset:([0-9a-f-]{36})/g, (_, id: string) => `file(${files.get(id)})`);
  };
  const pages = async (sectionId: string, parent: string | null): Promise<unknown[]> =>
    Promise.all(
      tree.pages
        .filter((p) => p.sectionId === sectionId && p.parentPageId === parent)
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
        .map(async (p) => {
          const page = (await me.get(`/api/v1/pages/${p.id}`)).json() as Page;
          const versions = (
            await me.get(`/api/v1/pages/${p.id}/versions`)
          ).json() as PageVersionMeta[];
          return {
            title: p.title,
            type: p.type,
            content: await withFiles(page.content),
            tags: (p.tags ?? []).map((id) => tags.get(id)).sort(),
            versions: versions.map((v) => `${v.reason}:${v.name ?? ''}`).sort(),
            children: await pages(sectionId, p.id),
          };
        }),
    );
  const sections = (notebookId: string, groupId: string | null) =>
    Promise.all(
      tree.sections
        .filter((s) => s.notebookId === notebookId && s.groupId === groupId)
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
        .map(async (s) => ({ name: s.name, color: s.color, pages: await pages(s.id, null) })),
    );
  const groups = (notebookId: string, parent: string | null): Promise<unknown[]> =>
    Promise.all(
      tree.groups
        .filter((g) => g.notebookId === notebookId && g.parentGroupId === parent)
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
        .map(async (g) => ({
          name: g.name,
          groups: await groups(notebookId, g.id),
          sections: await sections(notebookId, g.id),
        })),
    );
  const templates = (await me.get('/api/v1/templates')).json() as {
    name: string;
    content: string;
  }[];
  return {
    notebooks: await Promise.all(
      tree.notebooks
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
        .map(async (n) => ({
          name: n.name,
          color: n.color,
          icon: n.icon,
          groups: await groups(n.id, null),
          sections: await sections(n.id, null),
        })),
    ),
    inbox: await pages(tree.inboxId, null),
    templates: templates.map((t) => `${t.name}:${t.content}`),
    kanban: await kanban(),
  };

  async function kanban() {
    const list = (await me.get('/api/v1/projects')).json() as Projects;
    const titleOf = (id: string) => tree.pages.find((p) => p.id === id)?.title;
    return Promise.all(
      list.projects.map(async (p) => ({
        name: p.name,
        key: p.key,
        color: p.color,
        labels: list.labels.filter((l) => l.projectId === p.id).map((l) => `${l.name}:${l.color}`),
        boards: await Promise.all(
          list.boards
            .filter((b) => b.projectId === p.id)
            .map(async (b) => {
              const data = (await me.get(`/api/v1/boards/${b.id}`)).json() as BoardData;
              return {
                name: b.name,
                lanes: data.swimlanes.map((l) => l.name),
                columns: await Promise.all(
                  data.columns.map(async (c) => ({
                    name: c.name,
                    done: c.isDone,
                    wip: `${c.wipLimit}:${c.wipStrict}`,
                    cards: await Promise.all(
                      data.cards
                        .filter((x) => x.columnId === c.id)
                        .map(async (x) => {
                          const d = (await me.get(`/api/v1/cards/${x.id}`)).json() as CardDetail;
                          return {
                            key: d.key,
                            title: x.title,
                            priority: x.priority,
                            due: x.dueDate,
                            done: !!x.completedAt,
                            labels: x.labelIds.map(
                              (id) => data.labels.find((l) => l.id === id)?.name,
                            ),
                            description: await withFiles(d.description),
                            checklists: d.checklists.map((l) => [
                              l.title,
                              l.items.map((i) => i.text),
                            ]),
                            comments: d.comments.map((m) => m.body),
                            notes: d.pages.map((n) => titleOf(n.pageId)),
                            files: d.attachments.map((a) => a.name),
                          };
                        }),
                    ),
                  })),
                ),
              };
            }),
        ),
      })),
    );
  }
}

function unzip(file: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map<string, Buffer>();
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [path, data] of Object.entries(files)) {
    zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), path);
  }
  zip.end();
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

describe('.memora archives', () => {
  it('round-trips everything into a fresh instance, identically', async () => {
    const a = await start();
    await fill(a.me);
    const { job, file } = await exported(a.me, {
      format: 'memora',
      scope: 'everything',
      history: true,
    });
    expect(job.fileName).toMatch(/^Memora \d{4}-\d{2}-\d{2}\.memora$/);
    expect(job.exportReport).toMatchObject({ pages: 4, files: 1 });

    const b = await start();
    const result = await imported(b.me, file, 'name=backup.memora');
    expect(result.error).toBeNull();
    expect(result.importReport).toMatchObject({
      notebooks: 1,
      // Each new group starts with a section.
      sections: 4,
      pages: 4,
      files: 1,
      templates: 1,
      skipped: [],
      projects: 1,
      boards: 1,
      cards: 2,
    } satisfies Partial<ImportReport>);
    expect(await snapshot(b.me)).toEqual(await snapshot(a.me));

    // Links and search work on what came in.
    const plans = ((await b.me.get('/api/v1/tree')).json() as Tree).pages.find(
      (p) => p.title === 'Meeting notes',
    )!;
    expect(await backlinks(b.me, plans.id)).toEqual(['Plans']);
    const found = (await b.me.get('/api/v1/search?q=bread')).json();
    expect(found.hits.map((h: { title: string }) => h.title)).toEqual(['Quick note']);
  });

  it('lists every file in its manifest with its SHA-256, and rich pages as HTML too', async () => {
    const a = await start();
    await fill(a.me);
    const { file } = await exported(a.me, { format: 'memora', scope: 'everything' });
    const files = await unzip(file);
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest).toMatchObject({
      format: 'memora-archive',
      formatVersion: 1,
      appVersion: 'test',
    });
    expect(Object.keys(manifest.sha256).sort()).toEqual(
      [...files.keys()].filter((p) => p !== 'manifest.json').sort(),
    );
    const html = [...files.keys()].find((p) => p.endsWith('.html'))!;
    expect(files.get(html)!.toString()).toContain('<p>Hello</p>');
    expect(files.get(html)!.toString()).toMatch(
      /src="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/assets\/[0-9a-f]{64}\.png"/,
    );
    // No history unless asked for.
    expect([...files.keys()].some((p) => p.startsWith('history/'))).toBe(false);
  });

  it('encrypts with a password and asks for it back', async () => {
    const a = await start();
    const { notebookId } = await fill(a.me);
    const { file } = await exported(a.me, {
      format: 'memora',
      scope: 'notebook',
      id: notebookId,
      password: 'correct horse',
    });
    expect(file.subarray(0, 20).toString('latin1')).not.toContain('PK');

    const b = await start();
    expect((await imported(b.me, file, 'name=work.memora')).error).toMatch(/encrypted/);
    expect((await imported(b.me, file, 'name=work.memora', 'wrong horse')).error).toMatch(
      /password/i,
    );
    const ok = await imported(b.me, file, 'name=work.memora', 'correct horse');
    expect(ok.importReport).toMatchObject({ notebooks: 1, sections: 4, pages: 3 });
  });

  it('merges into a chosen notebook after a backup, with new ids', async () => {
    const a = await start();
    const { section, notebookId } = await fill(a.me);
    const { file } = await exported(a.me, { format: 'memora', scope: 'section', id: section });
    const result = await imported(a.me, file, `name=acme.memora&notebookId=${notebookId}`);
    expect(result.importReport).toMatchObject({ notebooks: 0, sections: 1, pages: 2 });
    const tree = (await a.me.get('/api/v1/tree')).json() as Tree;
    const acme = tree.sections.filter((s) => s.name === 'Acme');
    expect(acme).toHaveLength(2);
    expect(acme[1]!.notebookId).toBe(notebookId);
    // At the top of the notebook: the archive's groups weren't part of it.
    expect(acme[1]!.groupId).toBeNull();
    expect(new Set(tree.pages.map((p) => p.id)).size).toBe(tree.pages.length);
    const backups = (await a.me.get('/api/v1/admin/backups')).json();
    expect(backups.backups.map((b: { kind: string }) => b.kind)).toContain('pre-import');
  });

  it('refuses damaged, altered and newer archives', async () => {
    const a = await start();
    await fill(a.me);
    const { file } = await exported(a.me, { format: 'memora', scope: 'everything' });
    const files = await unzip(file);
    const path = [...files.keys()].find((p) => p.endsWith('.md'))!;

    const altered = await zipOf({ ...Object.fromEntries(files), [path]: 'Changed' });
    const b = await start();
    expect((await imported(b.me, altered, 'name=x.memora')).error).toMatch(/has changed/);

    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    const newer = await zipOf({
      ...Object.fromEntries(files),
      'manifest.json': JSON.stringify({ ...manifest, formatVersion: 99 }),
    });
    expect((await imported(b.me, newer, 'name=x.memora')).error).toMatch(/newer version/);

    const missing = new Map(files);
    missing.delete(path);
    expect(
      (await imported(b.me, await zipOf(Object.fromEntries(missing)), 'name=x.memora')).error,
    ).toMatch(/is missing/);
    expect((await imported(b.me, Buffer.from('not a zip'), 'name=x.memora')).error).toMatch(
      /isn’t a \.memora file/,
    );
    // Nothing was half imported.
    expect(((await b.me.get('/api/v1/tree')).json() as Tree).notebooks).toEqual([]);
  });
});

describe('Markdown', () => {
  it('exports a folder tree with front matter, files and relative links', async () => {
    const a = await start();
    const { notebookId } = await fill(a.me);
    const { job, file } = await exported(a.me, {
      format: 'markdown',
      scope: 'notebook',
      id: notebookId,
    });
    expect(job.fileName).toMatch(/^Work \d{4}-\d{2}-\d{2}\.zip$/);
    const files = await unzip(file);
    expect([...files.keys()].sort()).toEqual([
      'Work/Clients/Europe/Acme/Plans.md',
      'Work/Clients/Europe/Acme/Plans/Meeting notes.md',
      'Work/New section/Rich page.md',
      'assets/chart.png',
    ]);
    const plans = files.get('Work/Clients/Europe/Acme/Plans.md')!.toString();
    expect(plans).toMatch(/^---\nid: [0-9a-f-]{36}\ntags: \[client, Urgent\]\ncreated: /);
    expect(plans).toContain('![Chart](../../../../assets/chart.png)');
    expect(files.get('Work/New section/Rich page.md')!.toString()).toContain(
      '![](../../assets/chart.png)',
    );
  });

  it('exports one page without files as a .md file', async () => {
    const a = await start();
    const tree = (await a.me.get('/api/v1/tree')).json() as Tree;
    const id = (
      (
        await a.me.post('/api/v1/pages', {
          sectionId: tree.inboxId,
          title: 'Hello: world',
          content: 'Hi',
        })
      ).json() as TreeChanges
    ).pages![0]!.id;
    const { job, file } = await exported(a.me, { format: 'markdown', scope: 'page', id });
    expect(job.fileName).toMatch(/^Hello world \d{4}-\d{2}-\d{2}\.md$/);
    expect(file.toString()).toMatch(/^---\ntitle: "Hello: world"\nid: /);
    expect(file.toString()).toMatch(/---\n\nHi$/);
  });

  it('imports a zip of folders: notebook, groups, sections, subpages, front matter and images', async () => {
    const { me } = await start();
    const zip = await zipOf({
      'Research/Papers/Reading list.md':
        '---\ntitle: "Reading: list"\ntags: [books, later]\n---\n\n![Cover](../images/cover%20art.png)\n',
      'Research/Papers/Reading list/Chapter one.md': 'Notes on [[Reading: list]]',
      'Research/Archive/2025/Old.txt': 'Plain text',
      'Research/images/cover art.png': pngOf(2, 2),
      'Research/Top.md': 'At the top',
      '__MACOSX/Research/._Top.md': 'junk',
    });
    const job = await imported(me, zip, 'name=research.zip');
    expect(job.error).toBeNull();
    expect(job.importReport).toMatchObject({ notebooks: 1, sections: 3, pages: 4, files: 1 });
    const tree = (await me.get('/api/v1/tree')).json() as Tree;
    expect(tree.notebooks.map((n) => n.name)).toEqual(['Research']);
    expect(tree.groups.map((g) => g.name)).toEqual(['Archive']);
    expect(
      tree.sections
        .filter((s) => !s.isInbox)
        .map((s) => s.name)
        .sort(),
    ).toEqual(['2025', 'Papers', 'Research']);
    const reading = tree.pages.find((p) => p.title === 'Reading: list')!;
    expect(tree.pages.find((p) => p.title === 'Chapter one')!.parentPageId).toBe(reading.id);
    expect(reading.tags).toHaveLength(2);
    const content = ((await me.get(`/api/v1/pages/${reading.id}`)).json() as Page).content;
    const [, assetId] = /!\[Cover\]\(asset:([0-9a-f-]{36})\)/.exec(content)!;
    expect((await me.get(`/api/v1/assets/${assetId}`)).headers['content-type']).toBe('image/png');
    expect(await backlinks(me, reading.id)).toEqual(['Chapter one']);
  });

  it('round-trips its own export', async () => {
    const a = await start();
    const { notebookId } = await fill(a.me);
    const { file } = await exported(a.me, {
      format: 'markdown',
      scope: 'notebook',
      id: notebookId,
    });
    const b = await start();
    const job = await imported(b.me, file, 'name=work.zip');
    expect(job.importReport).toMatchObject({ notebooks: 1, pages: 3, files: 1 });
    const tree = (await b.me.get('/api/v1/tree')).json() as Tree;
    expect(tree.notebooks.map((n) => n.name)).toEqual(['Work']);
    expect(tree.groups.map((g) => g.name).sort()).toEqual(['Clients', 'Europe']);
    const plans = tree.pages.find((p) => p.title === 'Plans')!;
    const content = ((await b.me.get(`/api/v1/pages/${plans.id}`)).json() as Page).content;
    expect(content).toMatch(
      /^# Plans\n\nSee \[\[Meeting notes\]\]\.\n\n!\[Chart\]\(asset:[0-9a-f-]{36}\)\n$/,
    );
  });

  it('refuses a zip without pages', async () => {
    const { me } = await start();
    const job = await imported(me, await zipOf({ 'a.png': pngOf(1, 1) }), 'name=a.zip');
    expect(job.error).toMatch(/no Markdown files/);
  });
});

describe('jobs', () => {
  it('refuses files above the import limit before storing them', async () => {
    const { me } = await start({ MEMORA_MAX_IMPORT_MB: '1' });
    const res = await me.post('/api/v1/imports?name=big.zip', Buffer.alloc(1024 * 1024 + 1), {
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(res.statusCode).toBe(413);
  });

  it('checks what to export before starting', async () => {
    const { me } = await start();
    const res = await me.post('/api/v1/exports', {
      format: 'markdown',
      scope: 'notebook',
      id: uuidv7(),
    });
    expect(res.statusCode).toBe(404);
    const encrypted = await me.post('/api/v1/exports', {
      format: 'markdown',
      scope: 'everything',
      password: 'long enough',
    });
    expect(encrypted.statusCode).toBe(400);
  });

  it('reports progress over the event channel, and lists finished jobs', async () => {
    const { me } = await start();
    const socket = await me.events();
    const seen: Job[] = [];
    socket.on('message', (data: Buffer) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'job.updated') seen.push(event.job);
    });
    const { job } = await exported(me, { format: 'memora', scope: 'everything' });
    socket.terminate();
    expect(seen.map((j) => j.state)).toContain('done');
    expect(seen.at(-1)!.fileName).toBe(job.fileName);
    expect(((await me.get('/api/v1/jobs')).json() as Job[]).map((j) => j.id)).toEqual([job.id]);
  });
});

describe('PDF', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
    server = undefined;
  });

  it('says whether one-click PDFs are available', async () => {
    const { me } = await start();
    expect((await me.get('/api/v1/exports/options')).json()).toEqual({ pdf: false });
    expect((await me.post('/api/v1/exports/pdf', { name: 'x', html: '<p>x</p>' })).statusCode).toBe(
      404,
    );
  });

  it('sends Gotenberg a locked-down document with the images inside', async () => {
    let received = '';
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (c: Buffer) => chunks.push(c));
      request.on('end', () => {
        received = Buffer.concat(chunks).toString();
        response.writeHead(request.url === '/forms/chromium/convert/html' ? 200 : 404, {
          'content-type': 'application/pdf',
        });
        response.end('%PDF-1.7 fake');
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const { me } = await start({ MEMORA_GOTENBERG_URL: `http://127.0.0.1:${port}/` });
    expect((await me.get('/api/v1/exports/options')).json()).toEqual({ pdf: true });
    const imageId = uuidv7();
    await me.put(`/api/v1/assets/${imageId}?name=a.png`, pngOf(1, 1), {
      headers: { 'content-type': 'image/png' },
    });
    const res = await me.post('/api/v1/exports/pdf', {
      name: 'Plans',
      html: `<!doctype html><html><head><title>Plans</title></head><body><img src="asset:${imageId}"><img src="asset:${uuidv7()}"></body></html>`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('filename="Plans.pdf"');
    expect(res.body).toBe('%PDF-1.7 fake');
    expect(received).toContain('Content-Security-Policy');
    expect(received).toContain(`src="data:image/png;base64,${pngOf(1, 1).toString('base64')}"`);
    expect(received).toMatch(/src="asset:[0-9a-f-]{36}"/);
  });
});
