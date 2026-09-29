import { beforeEach, describe, expect, it } from 'vitest';
import { applyAccent, hueStyle, sectionColor } from './sections';
import { applyAppearance, useTheme } from './theme';

const root = document.documentElement;

describe('appearance', () => {
  beforeEach(() => {
    delete root.dataset.theme;
    delete root.dataset.glass;
    useTheme.setState({ theme: 'system', glass: 'auto' });
  });

  it('leaves <html> alone for the defaults, so the OS decides', () => {
    applyAppearance({ theme: 'system', glass: 'auto' });
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.glass).toBeUndefined();
  });

  it('forces a theme and solid panels on <html>', () => {
    useTheme.getState().setTheme('dark');
    useTheme.getState().setGlass('off');
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.glass).toBe('off');
  });

  it('remembers the choice on this device', () => {
    useTheme.getState().setTheme('light');
    expect(JSON.parse(localStorage.getItem('memora.appearance')!)).toEqual({
      theme: 'light',
      glass: 'auto',
    });
  });
});

describe('section colours', () => {
  it('maps a colour to its hue and chroma', () => {
    expect(hueStyle('teal')).toEqual({ '--h': 185, '--c': 1 });
    expect(sectionColor('slate').chroma).toBeLessThan(1);
  });

  it('falls back to blue for unknown ids', () => {
    expect(sectionColor('nope' as never).id).toBe('blue');
  });

  it('sets the page accent', () => {
    applyAccent('coral');
    expect(root.style.getPropertyValue('--ah')).toBe('25');
    expect(root.style.getPropertyValue('--ac')).toBe('1');
  });
});
