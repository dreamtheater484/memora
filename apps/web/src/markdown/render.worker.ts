import type { Nodes, Root } from 'hast';
import { toHast } from './pipeline';

/*
 * Parses Markdown off the main thread, so a long page never makes typing stutter: the
 * editor posts the text, the worker answers the sanitised HTML tree.
 */

interface Request {
  id: number;
  text: string;
}

/**
 * Only top-level blocks keep their position (the preview renders them one by one, keyed by
 * their source); inside them `data-line` says what scroll sync needs. Everything else would
 * only make the tree slower to copy back to the page.
 */
function slim(root: Root): Root {
  const strip = (node: Nodes) => {
    delete node.position;
    delete node.data;
    if ('children' in node) for (const child of node.children) strip(child);
  };
  for (const block of root.children) {
    if ('children' in block) for (const child of block.children) strip(child);
    delete block.data;
  }
  delete root.position;
  return root;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, text } = event.data;
  try {
    self.postMessage({ id, hast: slim(toHast(text)) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
