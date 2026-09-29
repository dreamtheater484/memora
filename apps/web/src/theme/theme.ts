import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';
export type GlassMode = 'auto' | 'on' | 'off';

interface ThemeState {
  theme: ThemeMode;
  glass: GlassMode;
  setTheme: (theme: ThemeMode) => void;
  setGlass: (glass: GlassMode) => void;
}

const STORAGE_KEY = 'memora.appearance';
const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark'];
const GLASS: readonly GlassMode[] = ['auto', 'on', 'off'];

/** Per-device appearance preference. Storage can be unavailable (private mode). */
function load(): Pick<ThemeState, 'theme' | 'glass'> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      theme: THEMES.includes(value.theme as ThemeMode) ? (value.theme as ThemeMode) : 'system',
      glass: GLASS.includes(value.glass as GlassMode) ? (value.glass as GlassMode) : 'auto',
    };
  } catch {
    return { theme: 'system', glass: 'auto' };
  }
}

function save(state: Pick<ThemeState, 'theme' | 'glass'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

/** Reflects the preference on <html>: data-theme / data-glass, absent = follow the OS. */
export function applyAppearance(
  { theme, glass }: Pick<ThemeState, 'theme' | 'glass'>,
  root: HTMLElement = document.documentElement,
) {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (glass === 'auto') delete root.dataset.glass;
  else root.dataset.glass = glass;
}

export const useTheme = create<ThemeState>()((set, get) => ({
  ...load(),
  setTheme: (theme) => {
    set({ theme });
    save({ theme, glass: get().glass });
    applyAppearance(get());
  },
  setGlass: (glass) => {
    set({ glass });
    save({ theme: get().theme, glass });
    applyAppearance(get());
  },
}));

/** The theme actually shown, resolving "system" through the OS preference. */
export function resolvedTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
