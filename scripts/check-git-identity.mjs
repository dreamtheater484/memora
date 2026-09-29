#!/usr/bin/env node
/**
 * Makes sure commits never expose a personal email address.
 *
 *   node scripts/check-git-identity.mjs            check the configured git identity (pre-commit)
 *   node scripts/check-git-identity.mjs --history  check the author/committer of every commit (CI)
 *
 * Allowed: GitHub noreply addresses (1234+name@users.noreply.github.com, bots included) and
 * noreply@github.com, which GitHub uses for merges made in its web interface.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const NOREPLY = /^(?:\d+\+)?[A-Za-z0-9-]+(?:\[bot\])?@users\.noreply\.github\.com$/i;
const GITHUB_WEB_FLOW = /^noreply@github\.com$/i;

export const isAllowedEmail = (email) => NOREPLY.test(email) || GITHUB_WEB_FLOW.test(email);

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function checkConfiguredIdentity() {
  if (tryGit(['rev-parse', '--git-dir']) === null) {
    console.warn('git identity check: not a git repository — skipped');
    return 0;
  }
  const email = tryGit(['config', 'user.email']) ?? '';
  if (isAllowedEmail(email)) return 0;
  console.error(
    '\n✖ Git identity check failed: commits must use your GitHub noreply email address.\n',
  );
  console.error(
    '  Find it at GitHub → Settings → Emails ("Keep my email addresses private"), then run:\n',
  );
  console.error('    git config user.email "<id>+<github-user>@users.noreply.github.com"\n');
  return 1;
}

function checkHistory() {
  if (tryGit(['rev-parse', '--verify', 'HEAD']) === null) return 0; // no commits yet
  const log = git(['log', '--all', '--format=%h%x09%ae%x09%ce']);
  const offenders = [];
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash, author, committer] = line.split('\t');
    if (!isAllowedEmail(author ?? '')) offenders.push(`${hash} (author)`);
    if (!isAllowedEmail(committer ?? '')) offenders.push(`${hash} (committer)`);
  }
  if (offenders.length === 0) return 0;
  console.error('\n✖ Commits with a non-noreply email address found:\n');
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error('\nRewrite these commits with your GitHub noreply address before pushing.\n');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = process.argv.includes('--history')
    ? checkHistory()
    : checkConfiguredIdentity();
}
