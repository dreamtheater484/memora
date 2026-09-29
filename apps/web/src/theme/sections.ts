import type { CSSProperties } from 'react';

/** The 12 section colours. Hues are OKLCH angles; `chroma` scales colourfulness. */
export const SECTION_COLORS = [
  { id: 'coral', name: 'Coral', hue: 25, chroma: 1 },
  { id: 'orange', name: 'Orange', hue: 50, chroma: 1 },
  { id: 'amber', name: 'Amber', hue: 75, chroma: 1 },
  { id: 'lime', name: 'Lime', hue: 125, chroma: 1 },
  { id: 'green', name: 'Green', hue: 150, chroma: 1 },
  { id: 'teal', name: 'Teal', hue: 185, chroma: 1 },
  { id: 'cyan', name: 'Cyan', hue: 215, chroma: 1 },
  { id: 'blue', name: 'Blue', hue: 255, chroma: 1 },
  { id: 'indigo', name: 'Indigo', hue: 275, chroma: 1 },
  { id: 'violet', name: 'Violet', hue: 300, chroma: 1 },
  { id: 'magenta', name: 'Magenta', hue: 330, chroma: 1 },
  { id: 'slate', name: 'Slate', hue: 250, chroma: 0.15 },
] as const;

export type SectionColorId = (typeof SECTION_COLORS)[number]['id'];
export type SectionColor = (typeof SECTION_COLORS)[number];

const byId = new Map<string, SectionColor>(SECTION_COLORS.map((c) => [c.id, c]));

export function sectionColor(id: SectionColorId): SectionColor {
  return byId.get(id) ?? SECTION_COLORS[7];
}

type HueStyle = CSSProperties & Record<'--h' | '--c', number>;

/**
 * Inline style for an element with class "hue": gives it --sec, --sec-soft,
 * --sec-softer and --sec-ink in this colour (see tokens.css).
 */
export function hueStyle(id: SectionColorId): HueStyle {
  const c = sectionColor(id);
  return { '--h': c.hue, '--c': c.chroma };
}

/** Makes a section colour the page-wide accent and ambient glow colour. */
export function applyAccent(id: SectionColorId, root: HTMLElement = document.documentElement) {
  const c = sectionColor(id);
  root.style.setProperty('--ah', String(c.hue));
  root.style.setProperty('--ac', String(c.chroma));
}
