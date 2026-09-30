import { PASSWORD_MIN_LENGTH } from '@memora/shared';

/*
 * How strong a new password looks (OWASP ASVS 2.1.8), shown while it is typed. A guide only:
 * the server enforces the rules (length, common passwords, the username).
 */

export interface Strength {
  /** 0 too short, 1 weak, 2 fair, 3 good, 4 strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const POOLS: [RegExp, number][] = [
  [/[a-z]/, 26],
  [/[A-Z]/, 26],
  [/[0-9]/, 10],
  [/[^a-zA-Z0-9]/, 33],
];

export function passwordStrength(password: string, username = ''): Strength {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return { score: 0, label: 'Too short' };
  const lower = password.toLowerCase();
  if (username.length >= 3 && lower.includes(username.toLowerCase())) {
    return { score: 1, label: 'Weak: it contains your username' };
  }
  if (new Set(lower).size < 5) return { score: 1, label: 'Weak: too many repeats' };
  const pool = POOLS.reduce((sum, [re, size]) => (re.test(password) ? sum + size : sum), 0);
  const bits = length * Math.log2(pool);
  if (bits < 60) return { score: 2, label: 'Fair' };
  if (bits < 80) return { score: 3, label: 'Good' };
  return { score: 4, label: 'Strong' };
}
