import { createContext } from 'react';

/** What image views need from the page: downloading an image that still points elsewhere. */
export interface RichViewHost {
  /** Downloads a web image into the page's files; answers its `asset:` address. */
  downloadImage(url: string): Promise<string>;
}

export const RichViewHostContext = createContext<RichViewHost>({
  downloadImage: () => Promise.reject(new Error('Not available')),
});
