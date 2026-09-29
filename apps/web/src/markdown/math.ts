import katex from 'katex';
import 'katex/dist/katex.min.css';

/*
 * Maths (§8.2): `$…$` and `$$…$$`, typeset by KaTeX. Loaded the first time a page shows a
 * formula. Without `trust`, KaTeX refuses links, classes and styles in formulas.
 */

export function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    output: 'htmlAndMathml',
  });
}
