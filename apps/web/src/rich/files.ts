import { isInlineImage } from '@memora/shared';
import type { Editor, JSONContent } from '@tiptap/core';
import { toast } from '../components/ui';
import { isWebImage, MAX_PASTED_DOWNLOADS } from '../lib/remoteImages';
import type { RichHost } from './host';

/*
 * Files in rich pages (§9.5): pasted, dropped or picked files are kept as the page's files
 * (offline too, like typing) and shown where they land; images in pasted HTML are downloaded
 * by the server, and images embedded in it uploaded, so the page never depends on elsewhere.
 */

/** Inserts kept files at `pos` (or the selection): images as images, the rest as file cards. */
export async function insertFiles(
  editor: Editor,
  files: File[],
  host: Pick<RichHost, 'addFile'>,
  pos?: number,
): Promise<void> {
  const nodes: JSONContent[] = [];
  for (const file of files) {
    const name = file.name || (isInlineImage(file.type) ? 'image.png' : 'file');
    const id = await host.addFile(file, name);
    nodes.push(
      isInlineImage(file.type)
        ? {
            type: 'image',
            attrs: {
              src: `asset:${id}`,
              alt: /^image\.\w+$/.test(name) ? 'Pasted image' : baseName(name),
            },
          }
        : {
            type: 'file',
            attrs: { src: `asset:${id}`, name, size: file.size, mime: file.type || null },
          },
    );
  }
  if (!nodes.length || editor.isDestroyed) return;
  const at = pos ?? editor.state.selection.to;
  editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), nodes).run();
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** Points every image showing `from` at `to`. */
function replaceImageSrc(editor: Editor, from: string, to: string) {
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.src === from) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to });
    }
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false));
}

/** Keeps pasted images: web images are downloaded by the server, embedded ones uploaded. */
export async function keepPastedImages(editor: Editor, sources: string[], host: RichHost) {
  let failed = 0;
  await Promise.all(
    sources.slice(0, MAX_PASTED_DOWNLOADS).map(async (src) => {
      try {
        let asset: string;
        if (isWebImage(src)) asset = await host.downloadImage(src);
        else {
          const blob = dataUrlToBlob(src);
          asset = `asset:${await host.addFile(blob, `image.${blob.type.split('/')[1] ?? 'png'}`)}`;
        }
        if (!editor.isDestroyed) replaceImageSrc(editor, src, asset);
      } catch {
        failed++;
      }
    }),
  );
  if (failed) {
    toast({
      title:
        failed === 1
          ? 'An image couldn’t be downloaded'
          : `${failed} images couldn’t be downloaded`,
      description: 'They still point to their websites. Select one to try again.',
      tone: 'error',
    });
  }
}

function dataUrlToBlob(url: string): Blob {
  const [head = '', data = ''] = url.split(',', 2);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
