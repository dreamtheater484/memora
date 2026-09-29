#!/usr/bin/env node
/**
 * Privacy guard: blocks personal information from being committed.
 *
 * Checks file contents and file names for:
 *   - generic personal patterns (home-directory paths, private IPs, email addresses, …)
 *   - personal strings listed in `.forbidden-strings.local` (gitignored, so the list itself
 *     is never committed)
 *
 * Usage:
 *   node scripts/check-forbidden.mjs                     scan all tracked + untracked (not ignored) files
 *   node scripts/check-forbidden.mjs --staged            scan staged content (pre-commit hook)
 *   node scripts/check-forbidden.mjs --message-file F    scan a commit message (commit-msg hook)
 *   node scripts/check-forbidden.mjs FILE...             scan specific files
 *
 * Add --personal-only to check just the personal strings. Use it for build output and Docker
 * image contents, where third-party code legitimately contains example IPs and author emails.
 *
 * A line containing `privacy-check: allow` is exempt from the generic rules (never from
 * personal strings). Use it sparingly and only for placeholders.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOW_MARKER = 'privacy-check: allow';
export const PERSONAL_LIST_FILE = '.forbidden-strings.local';

// Placeholder user names that may legitimately follow a home-directory prefix.
const PLACEHOLDER_USER = String.raw`(?:node|runner|user|username|you|your-user|yourname|me|example|<[^>]*>|\$\{?[A-Za-z_]+\}?|%[A-Za-z_]+%|\*)`;

export const GENERIC_RULES = [
  {
    id: 'unix-home-path',
    description: 'absolute Linux/macOS home directory path',
    regex: new RegExp(
      String.raw`(?<![\w.~-])/(?:home|Users)/(?!${PLACEHOLDER_USER}(?![\w.-]))[A-Za-z0-9._-]+`,
      'g',
    ),
  },
  {
    id: 'windows-user-path',
    description: 'Windows user profile path',
    regex: new RegExp(
      String.raw`\b[A-Za-z]:[\\/]+Users[\\/]+(?!(?:Public|Default|All Users|${PLACEHOLDER_USER})(?![\w.-]))[^\\/\s"'\x60]+`,
      'gi',
    ),
  },
  {
    id: 'wsl-user-path',
    description: 'WSL path into a Windows user profile',
    regex: new RegExp(
      String.raw`/mnt/[a-z]/Users/(?!(?:Public|Default|${PLACEHOLDER_USER})(?![\w.-]))[^/\s"'\x60]+`,
      'gi',
    ),
  },
  {
    id: 'removable-media-path',
    description: 'Linux removable-media mount path',
    regex: new RegExp(
      String.raw`(?<![\w.~-])/(?:run/)?media/(?!${PLACEHOLDER_USER}(?![\w.-]))[A-Za-z0-9._-]+/`,
      'g',
    ),
  },
  {
    id: 'private-ip',
    description: 'private network (RFC 1918) IPv4 address — use a placeholder such as <nas-ip>',
    regex:
      /(?<![\d.])(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?!\.?\d)/g,
  },
  {
    id: 'email-address',
    description: 'email address (only noreply and example addresses are allowed)',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allow: (match) =>
      /@users\.noreply\.github\.com$/i.test(match) ||
      /^(?:no-?reply|git)@/i.test(match) ||
      /@example\.(?:com|org|net)$/i.test(match) ||
      /\.(?:example|test|invalid|localhost)$/i.test(match),
    skipFiles: ['pnpm-lock.yaml'],
  },
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parses the personal strings list into rules. Plain entries match as whole words, case-insensitive. */
export function parsePersonalList(text) {
  const rules = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let source;
    if (line.startsWith('re:')) {
      source = line.slice(3);
    } else {
      const startsWord = /^\w/.test(line);
      const endsWord = /\w$/.test(line);
      source = `${startsWord ? '(?<![A-Za-z0-9_])' : ''}${escapeRegex(line)}${endsWord ? '(?![A-Za-z0-9_])' : ''}`;
    }
    rules.push({
      id: 'personal-string',
      description: `personal string from ${PERSONAL_LIST_FILE}`,
      regex: new RegExp(source, 'gi'),
      personal: true,
    });
  }
  return rules;
}

/** Returns the findings for one piece of text. */
export function scanText(text, rules, { fileName = '' } = {}) {
  const findings = [];
  const baseName = path.basename(fileName);
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const allowed = line.includes(ALLOW_MARKER);
    for (const rule of rules) {
      if (allowed && !rule.personal) continue;
      if (rule.skipFiles?.includes(baseName)) continue;
      for (const match of line.matchAll(rule.regex)) {
        if (rule.allow?.(match[0])) continue;
        findings.push({
          rule: rule.id,
          description: rule.description,
          line: index + 1,
          column: (match.index ?? 0) + 1,
          match: match[0],
        });
      }
    }
  });
  return findings;
}

const isBinary = (buffer) => buffer.subarray(0, 8000).includes(0);

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
}

function repoRoot() {
  try {
    return git(['rev-parse', '--show-toplevel'], process.cwd()).toString('utf8').trim();
  } catch {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  }
}

function splitNul(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

function redact(value) {
  if (!process.env.CI) return value;
  return value.length <= 4 ? '****' : `${value.slice(0, 2)}…(${value.length} chars)`;
}

function collectTargets(args, root) {
  if (args[0] === '--staged') {
    const names = splitNul(
      git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root),
    );
    return names.map((name) => ({ name, read: () => git(['show', `:${name}`], root) }));
  }
  if (args[0] === '--message-file') {
    const file = args[1];
    if (!file) throw new Error('--message-file needs a path');
    return [{ name: 'commit message', read: () => readFileSync(file), isMessage: true }];
  }
  if (args.length > 0) {
    return args
      .filter((name) => path.basename(name) !== PERSONAL_LIST_FILE)
      .map((name) => ({ name, read: () => readFileSync(name) }));
  }
  const names = splitNul(
    git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root),
  );
  return names
    .filter((name) => existsSync(path.join(root, name)))
    .map((name) => ({ name, read: () => readFileSync(path.join(root, name)) }));
}

function main(argv) {
  const personalOnly = argv.includes('--personal-only');
  const args = argv.filter((arg) => arg !== '--personal-only');
  const root = repoRoot();
  const personalFile = path.join(root, PERSONAL_LIST_FILE);
  const personalRules = existsSync(personalFile)
    ? parsePersonalList(readFileSync(personalFile, 'utf8'))
    : [];
  if (personalOnly && personalRules.length === 0) {
    console.error(`privacy check: --personal-only needs ${PERSONAL_LIST_FILE}`);
    return 2;
  }
  const rules = personalOnly ? personalRules : [...GENERIC_RULES, ...personalRules];

  let targets;
  try {
    targets = collectTargets(args, root);
  } catch (error) {
    console.error(`privacy check: ${error.message}`);
    return 2;
  }

  const problems = [];
  for (const target of targets) {
    if (!target.isMessage) {
      for (const finding of scanText(target.name, rules)) {
        problems.push({ file: target.name, ...finding, inFileName: true });
      }
    }
    const content = target.read();
    if (isBinary(content)) continue;
    for (const finding of scanText(content.toString('utf8'), rules, { fileName: target.name })) {
      problems.push({ file: target.name, ...finding });
    }
  }

  if (problems.length === 0) {
    if (!personalRules.length && !process.env.CI) {
      console.warn(
        `privacy check: passed (note: no ${PERSONAL_LIST_FILE} found — personal strings not checked; see CONTRIBUTING.md)`,
      );
    }
    return 0;
  }

  console.error('\n✖ Privacy check failed — personal information must never be committed:\n');
  for (const p of problems) {
    const where = p.inFileName ? `${p.file} (file name)` : `${p.file}:${p.line}:${p.column}`;
    console.error(`  ${where}  ${p.rule}: ${p.description}  →  "${redact(p.match)}"`);
  }
  console.error(
    '\nReplace the value with a placeholder (for example <nas-ip>, <your-user>, notes.example.com),',
  );
  console.error(`or add "${ALLOW_MARKER}" to the line if it is a genuine placeholder.\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
