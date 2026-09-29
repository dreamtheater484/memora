/** Initials for avatars: first letter of the first and last word. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const firstWord = parts[0];
  if (!firstWord) return '?';
  const lastWord = parts.length > 1 ? parts[parts.length - 1] : undefined;
  // Spread by code point so letters outside the BMP are not split.
  const first = [...firstWord][0] ?? '';
  const last = lastWord ? ([...lastWord][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stable hue per name, so a person keeps the same colour everywhere. */
export function nameHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}
