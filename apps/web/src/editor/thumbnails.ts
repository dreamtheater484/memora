import { ASSET_SCHEME, assetPath } from '@memora/shared';
import { RangeSetBuilder, StateField, type EditorState, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

/*
 * Optional image thumbnails in the source view (§9.3): a small preview under each line with
 * `![…](…)`, so a page's pictures are visible while writing. Updated only for the lines a
 * change touches, so long pages stay quick.
 */

const IMAGE = /!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export type LocalFile = (id: string) => Promise<string | null>;

class ThumbnailWidget extends WidgetType {
  constructor(
    readonly srcs: readonly string[],
    readonly localFile: LocalFile,
  ) {
    super();
  }

  override eq(other: ThumbnailWidget) {
    return other.srcs.join('\n') === this.srcs.join('\n');
  }

  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-image-thumb';
    wrap.setAttribute('aria-hidden', 'true');
    for (const src of this.srcs) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      if (src.startsWith(ASSET_SCHEME)) {
        const id = src.slice(ASSET_SCHEME.length);
        img.src = assetPath(id);
        void this.localFile(id).then((url) => {
          if (url) img.src = url;
        });
      } else if (/^https?:\/\//.test(src)) {
        img.src = src;
        img.referrerPolicy = 'no-referrer';
      } else continue;
      img.onerror = () => img.remove();
      wrap.append(img, ' ');
    }
    return wrap;
  }

  override get estimatedHeight() {
    return 140;
  }

  override ignoreEvent() {
    return true;
  }
}

function lineThumbs(doc: Text, lineNumber: number, localFile: LocalFile) {
  const line = doc.line(lineNumber);
  if (!line.text.includes('![')) return null;
  const srcs = [...line.text.matchAll(IMAGE)].map((m) => m[1]!);
  if (!srcs.length) return null;
  return {
    at: line.to,
    deco: Decoration.widget({ widget: new ThumbnailWidget(srcs, localFile), block: true, side: 1 }),
  };
}

function build(state: EditorState, localFile: LocalFile): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const thumb = lineThumbs(state.doc, n, localFile);
    if (thumb) builder.add(thumb.at, thumb.at, thumb.deco);
  }
  return builder.finish();
}

export function imageThumbnails(localFile: LocalFile) {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, localFile),
    update(decorations, tr) {
      if (!tr.docChanged) return decorations;
      let next = decorations.map(tr.changes);
      const doc = tr.state.doc;
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        const first = doc.lineAt(fromB);
        const last = doc.lineAt(toB);
        next = next.update({
          filterFrom: first.from,
          filterTo: last.to,
          filter: () => false,
        });
        const added: { at: number; deco: Decoration }[] = [];
        for (let n = first.number; n <= last.number; n += 1) {
          const thumb = lineThumbs(doc, n, localFile);
          if (thumb) added.push(thumb);
        }
        next = next.update({ add: added.map((a) => a.deco.range(a.at)), sort: true });
      });
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
