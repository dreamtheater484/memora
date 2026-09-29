import { createContext, useContext } from 'react';

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
