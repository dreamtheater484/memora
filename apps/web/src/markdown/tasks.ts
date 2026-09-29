/** Toggles the task box on a source line (`- [ ]` ↔ `- [x]`); unchanged if there is none. */
export function toggleTask(text: string, line: number): string {
  const lines = text.split('\n');
  const current = lines[line - 1];
  if (current === undefined) return text;
  const next = current.replace(
    /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\])/,
    (_m, open: string, mark: string, close: string) => `${open}${mark === ' ' ? 'x' : ' '}${close}`,
  );
  if (next === current) return text;
  lines[line - 1] = next;
  return lines.join('\n');
}
