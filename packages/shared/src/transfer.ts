import { z } from 'zod';
import { idSchema } from './notes';

/*
 * Import and export (§9.10). The server builds `.memora` archives and Markdown folders, and
 * reads them back, as background jobs whose progress reaches the browser over the event
 * channel; their files are kept for a day. Word, HTML, PDF and single files are made and read
 * in the browser.
 */

export const SERVER_EXPORT_FORMATS = ['memora', 'markdown'] as const;
export type ServerExportFormat = (typeof SERVER_EXPORT_FORMATS)[number];

export const EXPORT_SCOPES = ['page', 'section', 'group', 'notebook', 'everything'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

/** `POST /exports`: what to export, and how. */
export const exportRequestSchema = z
  .object({
    format: z.enum(SERVER_EXPORT_FORMATS),
    scope: z.enum(EXPORT_SCOPES),
    /** The page, section, group or notebook (none for everything). */
    id: idSchema.optional(),
    /** Encrypts a `.memora` archive with this password. */
    password: z.string().min(8, 'Use at least 8 characters.').max(200).optional(),
    /** Includes pages' version history in a `.memora` archive. */
    history: z.boolean().default(false),
  })
  .refine((v) => v.scope === 'everything' || v.id !== undefined, {
    message: 'Choose what to export.',
    path: ['id'],
  })
  .refine((v) => v.format === 'memora' || v.password === undefined, {
    message: 'Only .memora archives can be encrypted.',
    path: ['password'],
  });
export type ExportRequest = z.input<typeof exportRequestSchema>;

/**
 * `POST /imports?…`: the file is the body; these say where it goes. An encrypted archive's
 * password goes in the `X-Memora-Archive-Password` header, never in the address.
 */
export const importQuerySchema = z.object({
  name: z.string().min(1).max(255),
  /** Into this notebook (merging), or as new notebooks when absent. */
  notebookId: idSchema.optional(),
});
export type ImportQuery = z.input<typeof importQuerySchema>;

export const JOB_STATES = ['queued', 'running', 'done', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface ImportReport {
  notebooks: number;
  sections: number;
  pages: number;
  files: number;
  templates: number;
  /** What couldn't be imported, and why. */
  skipped: { name: string; reason: string }[];
  /** The first page imported, to open. */
  firstPageId: string | null;
}

export interface ExportReport {
  pages: number;
  files: number;
  /** Pages whose rich content Markdown couldn't keep entirely, with what it lost. */
  lost: { title: string; lost: string[] }[];
}

export interface Job {
  id: string;
  kind: 'export' | 'import';
  state: JobState;
  /** 0 to 1. */
  progress: number;
  /** What it is doing, for the progress bar. */
  message: string;
  /** The file to download, once an export is done. */
  fileName: string | null;
  size: number | null;
  exportReport: ExportReport | null;
  importReport: ImportReport | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
  /** When the export's file is deleted. */
  expiresAt: number | null;
}

/** How long an export's file stays available. */
export const JOB_FILE_HOURS = 24;

/** `GET /exports/options`: what this server can make. */
export interface ExportOptions {
  /** A PDF service (Gotenberg) is set up: PDFs are made in one click. */
  pdf: boolean;
}

/** `POST /exports/pdf`: a printable document, made in the browser, turned into a PDF. */
export const pdfRequestSchema = z.object({
  /** The file name, without `.pdf`. */
  name: z.string().min(1).max(200),
  /** A complete HTML document; Memora's files are referred to as `asset:<id>`. */
  html: z
    .string()
    .min(1)
    .max(30 * 1024 * 1024),
});
export type PdfRequest = z.infer<typeof pdfRequestSchema>;

// The `.memora` archive (docs/FILE_FORMAT.md)

export const ARCHIVE_FORMAT = 'memora-archive';
export const ARCHIVE_VERSION = 1;

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  scope: { type: ExportScope; ids: string[] };
  counts: {
    notebooks: number;
    groups: number;
    sections: number;
    pages: number;
    assets: number;
    templates: number;
    versions: number;
  };
  /** SHA-256 of every other file in the archive, by path. */
  sha256: Record<string, string>;
}

// Names and front matter (§8.5)

/** A file name any system accepts, made from a title. */
export function safeFileName(title: string, fallback = 'Untitled'): string {
  const clean = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 100)
    .trim();
  const name = clean || fallback;
  // Names Windows keeps for devices.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `${name}_` : name;
}

/** Keeps names unique in one folder, whatever their case: "Plan", "Plan (2)", … */
export function uniqueNames(): (name: string) => string {
  const used = new Set<string>();
  return (name) => {
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${name} (${n})`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

export interface FrontMatter {
  id?: string;
  title?: string;
  tags?: string[];
  created?: string;
  updated?: string;
}

const yamlString = (value: string) =>
  /^[\w .,@/+-]*$/.test(value) && value.trim() === value && value !== ''
    ? value
    : JSON.stringify(value);

/** A front-matter block for a Markdown file. */
export function writeFrontMatter(fields: FrontMatter): string {
  const lines: string[] = [];
  if (fields.title !== undefined) lines.push(`title: ${yamlString(fields.title)}`);
  if (fields.id) lines.push(`id: ${fields.id}`);
  if (fields.tags?.length) lines.push(`tags: [${fields.tags.map(yamlString).join(', ')}]`);
  if (fields.created) lines.push(`created: ${fields.created}`);
  if (fields.updated) lines.push(`updated: ${fields.updated}`);
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
}

function yamlValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/**
 * Reads a front-matter block, if the text starts with one: the fields Memora knows (the rest
 * is ignored) and the text after it.
 */
export function readFrontMatter(text: string): { fields: FrontMatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: FrontMatter = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!line) continue;
    const [, key, rest = ''] = line;
    let values: string[] | null = null;
    if (rest.startsWith('[')) {
      values = rest
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(yamlValue)
        .filter(Boolean);
    } else if (rest === '') {
      // A block list: "- item" lines.
      values = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) {
        values.push(yamlValue(lines[i + 1]!.replace(/^\s*-\s+/, '')));
        i += 1;
      }
    }
    const value = yamlValue(rest);
    switch (key!.toLowerCase()) {
      case 'title':
        fields.title = value;
        break;
      case 'id':
        fields.id = value;
        break;
      case 'tags':
        fields.tags = values ?? (value ? value.split(/[,\s]+/).filter(Boolean) : []);
        break;
      case 'created':
      case 'date':
        fields.created = value;
        break;
      case 'updated':
      case 'modified':
        fields.updated = value;
        break;
    }
  }
  return { fields, body: text.slice(match[0].length).replace(/^\r?\n/, '') };
}
