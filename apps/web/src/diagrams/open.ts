import { useShell } from '../shell/store';

/*
 * Opening the diagram editor (§9.3, §9.4) from either kind of page: with a diagram's code,
 * or with none to start from the template gallery. `onDone` gets the code to put in the
 * page, once, when the editor closes with Done.
 */

export interface DiagramEditRequest {
  code: string | null;
  page: 'markdown' | 'rich';
  onDone: (code: string) => void;
}

export function openDiagramEditor(request: DiagramEditRequest): void {
  useShell.getState().openDialog({ kind: 'diagram', ...request });
}
