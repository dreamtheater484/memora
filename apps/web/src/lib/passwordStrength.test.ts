import { describe, expect, it } from 'vitest';
import { passwordStrength } from './passwordStrength';

describe('passwordStrength', () => {
  it('grades by length and variety', () => {
    expect(passwordStrength('short').score).toBe(0);
    expect(passwordStrength('aaaaaaaaaaaaaa').score).toBe(1);
    expect(passwordStrength('abcdefghijkl').label).toBe('Fair');
    expect(passwordStrength('abcdefghijklmnop').label).toBe('Good');
    expect(passwordStrength('violet-harbour-lantern').label).toBe('Strong');
    expect(passwordStrength('Tr0ub4dor&3xy').score).toBe(4);
  });

  it('calls a password with the username in it weak', () => {
    expect(passwordStrength('alex-harbour-lantern', 'Alex')).toEqual({
      score: 1,
      label: 'Weak: it contains your username',
    });
    // Too short a name to judge by.
    expect(passwordStrength('violet-harbour-lantern', 'vi').score).toBe(4);
  });
});
