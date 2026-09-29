import { describe, expect, it } from 'vitest';
import { ALLOW_MARKER, GENERIC_RULES, parsePersonalList, scanText } from './check-forbidden.mjs';

// Fixtures are assembled from pieces so this file never trips the check it tests.
const home = ['', 'home', 'alice', 'projects'].join('/');
const macHome = ['', 'Users', 'alice', 'code'].join('/');
const winHome = ['C:', 'Users', 'alice', 'Desktop'].join('\\');
const media = ['', 'run', 'media', 'alice', 'Disk', 'notes'].join('/');
const lanIp = ['192', '168', '1', '20'].join('.');
const email = ['alice', 'mail.com'].join('@');

const rulesHit = (text, rules = GENERIC_RULES, options) =>
  scanText(text, rules, options).map((f) => f.rule);

describe('generic rules', () => {
  it.each([
    [`cd ${home}`, 'unix-home-path'],
    [`open ${macHome}`, 'unix-home-path'],
    [`path = "${winHome}"`, 'windows-user-path'],
    [`mounted at ${media}`, 'removable-media-path'],
    [`NAS at ${lanIp}.`, 'private-ip'],
    [`contact ${email}`, 'email-address'],
  ])('flags %s', (text, rule) => {
    expect(rulesHit(text)).toContain(rule);
  });

  it.each([
    'COPY --chown=node:node . /home/node/app',
    'runs-on paths like /home/runner/work',
    'placeholder /home/<your-user>/memora',
    'see https://example.com/media/logo/ for artwork',
    'bind to 127.0.0.1:3000 or 0.0.0.0',
    'documentation range 192.0.2.10',
    'version 10.2.3 of a package',
    'commit as 1234+someone@users.noreply.github.com',
    'git@github.com:owner/repo.git',
    'mail admin@example.com',
    'import pkg from "@fastify/static"',
  ])('allows %s', (text) => {
    expect(rulesHit(text)).toEqual([]);
  });

  it('honours the allow marker for generic rules', () => {
    expect(rulesHit(`${lanIp} # ${ALLOW_MARKER}`)).toEqual([]);
  });

  it('skips the email rule in the lockfile', () => {
    expect(rulesHit(`x ${email}`, GENERIC_RULES, { fileName: 'pnpm-lock.yaml' })).toEqual([]);
  });

  it('reports line and column', () => {
    const [finding] = scanText(`first line\n  ip ${lanIp}`, GENERIC_RULES);
    expect(finding).toMatchObject({ rule: 'private-ip', line: 2, column: 6 });
  });
});

describe('personal strings', () => {
  const personal = parsePersonalList(
    ['# comment', 'jdoe', '', 'Acme Corp', '/volumeX/private', 're:secret-\\d+'].join('\n'),
  );

  it('matches whole words, case-insensitively', () => {
    expect(rulesHit('owner: JDoe', personal)).toEqual(['personal-string']);
    expect(rulesHit('works at acme corp', personal)).toEqual(['personal-string']);
    expect(rulesHit('mounted on /volumeX/private/docker', personal)).toEqual(['personal-string']);
    expect(rulesHit('token secret-42', personal)).toEqual(['personal-string']);
  });

  it('does not match inside longer words', () => {
    expect(rulesHit('the jdoesmith account', personal)).toEqual([]);
  });

  it('is not bypassed by the allow marker', () => {
    expect(rulesHit(`jdoe ${ALLOW_MARKER}`, personal)).toEqual(['personal-string']);
  });
});
