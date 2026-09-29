import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/*
 * Exactly two columns for wide characters (§9.3): JetBrains Mono has no Chinese, Japanese or
 * Korean glyphs, and the fallback fonts' glyphs (and emoji) aren't exactly twice its width.
 * Each wide character gets a box of 2ch, so tables in the source line up with any font, the
 * same way the formatter counts them.
 */

const WIDE =
  /\p{RGI_Emoji}|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{20000}-\u{3FFFD}]/gv;

const wide = Decoration.mark({ class: 'cm-wide' });

const decorator = new MatchDecorator({ regexp: WIDE, decoration: () => wide });

export const wideCharacters = [
  ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.baseTheme({
    '.cm-wide': { display: 'inline-block', width: '2ch', textAlign: 'center' },
  }),
];
