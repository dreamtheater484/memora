import { describe, expect, it } from 'vitest';
import { isAllowedEmail } from './check-git-identity.mjs';

describe('isAllowedEmail', () => {
  it.each([
    '12345+someone@users.noreply.github.com',
    'someone@users.noreply.github.com',
    '49699333+dependabot[bot]@users.noreply.github.com',
    'noreply@github.com',
  ])('allows %s', (email) => {
    expect(isAllowedEmail(email)).toBe(true);
  });

  it.each([
    ['someone', 'mail.com'].join('@'),
    ['someone', 'users.noreply.github.com.evil.test'].join('@'),
    '',
  ])('rejects %s', (email) => {
    expect(isAllowedEmail(email)).toBe(false);
  });
});
