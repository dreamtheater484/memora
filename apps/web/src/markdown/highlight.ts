import type { Root } from 'hast';
import type { HighlighterCore } from 'shiki/core';

/*
 * Code highlighting for the preview (§9.3), with Shiki: loaded the first time a page shows a
 * code block, and each language only when a block uses it. Colours follow the theme through
 * CSS variables, so switching light and dark needs no new highlighting.
 */

let highlighter: Promise<HighlighterCore> | null = null;

async function load(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] =
    await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ]);
  return createHighlighterCore({
    themes: [light.default, dark.default],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
}

/** Short names people write after the fence, mapped to Shiki's names. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  md: 'markdown',
  cs: 'csharp',
  'c#': 'csharp',
  ps1: 'powershell',
  docker: 'dockerfile',
  kt: 'kotlin',
  rs: 'rust',
  golang: 'go',
  html: 'html',
  xml: 'xml',
};

/** Shiki with the language loaded, or null for a language it doesn't know. */
async function ready(language: string): Promise<{ shiki: HighlighterCore; lang: string } | null> {
  const { bundledLanguages } = await import('shiki/langs');
  const lang = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const loader = (bundledLanguages as Record<string, (() => Promise<unknown>) | undefined>)[lang];
  if (!loader) return null;
  highlighter ??= load();
  const shiki = await highlighter;
  if (!shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage((await loader()) as never);
  }
  return { shiki, lang };
}

/** One coloured piece of a line: its text and the colours for both themes, as CSS. */
export interface CodeToken {
  text: string;
  style: string;
}

/** The code as lines of coloured pieces (rich pages colour their code blocks this way). */
export async function highlightTokens(
  code: string,
  language: string,
): Promise<CodeToken[][] | null> {
  const loaded = await ready(language);
  if (!loaded) return null;
  const lines = loaded.shiki.codeToTokens(code, {
    lang: loaded.lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  }).tokens;
  return lines.map((line) =>
    line.map((token) => ({
      text: token.content,
      style: Object.entries(token.htmlStyle ?? {})
        .map(([name, value]) => `${name}:${value}`)
        .join(';'),
    })),
  );
}

/** The block as highlighted HTML, or null for an unknown language (shown plain). */
export async function highlight(code: string, language: string): Promise<Root | null> {
  const loaded = await ready(language);
  if (!loaded) return null;
  const { shiki, lang } = loaded;
  return shiki.codeToHast(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
}
