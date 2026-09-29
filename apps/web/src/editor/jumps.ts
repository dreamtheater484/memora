/*
 * The outline jumps to a heading in whichever view shows the page. Kept apart from the editor
 * so the page details panel can use it without loading the editor.
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
