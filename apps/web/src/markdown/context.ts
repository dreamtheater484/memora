import { ASSET_SCHEME, assetPath } from '@memora/shared';
import { createContext, useContext, useEffect, useState } from 'react';

/*
 * What the preview needs from the app around it: finding pages by title (wiki links), opening
 * them, and where to load a page's files from. Kept apart from the preview so the preview can
 * be rendered on its own (tests, the gallery).
 */

export interface PreviewHost {
  /** The page a wiki link's title names, if there is one. */
  findPage(title: string): { id: string; title: string } | null;
  openPage(id: string): void;
  /** Where to show a file from: its copy on this device while it waits to be sent. */
  localFile(id: string): Promise<string | null>;
}

const noHost: PreviewHost = {
  findPage: () => null,
  openPage: () => {},
  localFile: async () => null,
};

export const PreviewHostContext = createContext<PreviewHost>(noHost);

export const usePreviewHost = (): PreviewHost => useContext(PreviewHostContext);

/** Where a file referred to as `asset:<id>` loads from: this device's copy, or the server. */
export function useFileSrc(src: string | undefined): string | undefined {
  const host = usePreviewHost();
  const id = src?.startsWith(ASSET_SCHEME) ? src.slice(ASSET_SCHEME.length) : null;
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void host.localFile(id).then((url) => live && setLocal(url));
    return () => {
      live = false;
    };
  }, [host, id]);
  if (!id) return src;
  return local ?? assetPath(id);
}
