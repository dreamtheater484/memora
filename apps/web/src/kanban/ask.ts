import { useShell } from '../shell/store';

/** Asks for a name in a small dialog (new columns and lanes, renaming lanes and boards). */
export function askName(
  title: string,
  label: string,
  submit: (name: string) => Promise<unknown>,
  initial = '',
) {
  useShell.getState().openDialog({ kind: 'kanban-name', title, label, initial, submit });
}
