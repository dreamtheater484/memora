/*
 * The outline jumps to a heading in whichever view shows the page, and the title hands the
 * cursor on to the page's text. Kept apart from the editors so the page details panel and
 * the title can use them without loading an editor.
 */

type Jump = (line: number) => void;

const jumps = new Map<string, Jump>();

/** The open page's view registers how to show a source line; answers the unregister. */
export function registerJump(pageId: string, jump: Jump): () => void {
  jumps.set(pageId, jump);
  return () => {
    if (jumps.get(pageId) === jump) jumps.delete(pageId);
  };
}

export function jumpTo(pageId: string, line: number): void {
  jumps.get(pageId)?.(line);
}

type Focus = () => void;

const focuses = new Map<string, Focus>();

/** The open page's editor registers how to take the cursor, at the start of the text. */
export function registerFocus(pageId: string, focus: Focus): () => void {
  focuses.set(pageId, focus);
  return () => {
    if (focuses.get(pageId) === focus) focuses.delete(pageId);
  };
}

/** Puts the cursor at the start of the page's text, if its editor is open. */
export function focusPage(pageId: string): void {
  focuses.get(pageId)?.();
}
