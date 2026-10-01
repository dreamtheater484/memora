/*
 * What the rich editor needs from the page around it.
 */

export interface RichHost {
  /** Keeps a file until the server has it (made smaller first if so set); answers its id. */
  addFile(file: Blob, name: string): Promise<string>;
  /** Downloads a web image into the page's files; answers its `asset:` address. */
  downloadImage(url: string): Promise<string>;
  pages(): { id: string; title: string }[];
  /** Files chosen with the system's file picker. */
  pickFiles(images: boolean): Promise<File[]>;
  /** Opens the link dialog for the selection. */
  editLink(): void;
  /** Opens the formula editor: for the formula at `pos`, or a new one. */
  editMath(target: { pos: number | null; latex: string; inline: boolean }): void;
  /** Follows a link (a page, a file or a website). */
  openLink(href: string): void;
  /** Opens the list of the computer's own fonts, for the selection. */
  pickFont(): void;
}
