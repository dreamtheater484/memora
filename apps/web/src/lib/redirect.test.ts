import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
  it('keeps paths in this app, with their query', () => {
    expect(safeRedirect('/settings/account')).toBe('/settings/account');
    expect(safeRedirect('/?page=p1')).toBe('/?page=p1');
  });

  it('refuses anything that could lead to another site', () => {
    for (const value of [
      '//example.com',
      '/\\example.com',
      'https://example.com',
      'javascript:alert(1)',
      'settings',
      '',
      undefined,
      42,
    ]) {
      expect(safeRedirect(value), String(value)).toBeUndefined();
    }
  });
});
