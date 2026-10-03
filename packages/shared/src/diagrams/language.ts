import { DIAGRAM_LANGUAGE } from './index';

/*
 * Whether a code block's or a fence's language makes it a diagram. People write ```Mermaid
 * and ```MERMAID as well as ```mermaid, and Markdown apps draw all of them, so the language is
 * compared without case. What Memora writes itself is always DIAGRAM_LANGUAGE.
 */

export function isDiagramLanguage(language: unknown): boolean {
  return typeof language === 'string' && language.trim().toLowerCase() === DIAGRAM_LANGUAGE;
}
