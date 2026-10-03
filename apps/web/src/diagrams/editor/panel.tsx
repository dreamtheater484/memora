import type { DiagramModel } from '@memora/shared';
import type { ReactNode } from 'react';
import type { EditStart } from './keys';
import type { Selectable, Selection } from './selection';

/*
 * What every type's panel gets from the editor (§9.4), and the pieces they share.
 */

export interface ChangeOptions {
  /** Typing in one field is one step of the history. */
  merge?: string;
  /** What is selected after it (left out: what was). */
  select?: Selectable;
  edit?: EditStart;
  announce?: string;
}

export interface PanelProps<M extends DiagramModel> {
  model: M;
  change: (next: M, options?: ChangeOptions) => void;
  selection: Selection;
  select: (selection: Selection) => void;
  startEdit: (edit: EditStart) => void;
  announce: (message: string) => void;
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="diagram-panel-section">
      <div className="diagram-panel-heading">
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
