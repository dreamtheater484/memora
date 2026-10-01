import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import './diagrams.css';
import { useDiagramTheme } from './useDiagramTheme';

/*
 * A diagram drawn in a page (§9.3, §9.4): in the Markdown preview, in a rich page, in the
 * template gallery. Drawn once it comes near the screen, so long pages open quickly, and
 * again when the app turns light or dark.
 */

type State =
  { kind: 'waiting' } | { kind: 'drawn'; svg: string } | { kind: 'failed'; message: string };

export interface DrawnDiagramProps {
  code: string;
  /** For screen readers; a summary of the diagram's words when not given. */
  label?: string;
  className?: string;
  /** Shown instead of the drawing when the code has a mistake. */
  failed?: (message: string) => ReactNode;
  /** Draws at once rather than when near the screen. */
  eager?: boolean;
}

export function DrawnDiagram({ code, label, className, failed, eager }: DrawnDiagramProps) {
  const theme = useDiagramTheme();
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => !!eager || typeof IntersectionObserver !== 'function');
  const [state, setState] = useState<State>({ kind: 'waiting' });

  useEffect(() => {
    if (near || !box.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    import('./render')
      .then(({ renderDiagram }) => renderDiagram(code, theme, label))
      .then(
        (drawing) => live && setState({ kind: 'drawn', svg: drawing.svg }),
        (error: unknown) =>
          live &&
          setState({
            kind: 'failed',
            message: error instanceof Error ? error.message : 'The diagram has a mistake',
          }),
      );
    return () => {
      live = false;
    };
  }, [near, code, theme, label]);

  if (state.kind === 'failed' && failed) return <>{failed(state.message)}</>;
  return (
    <div
      ref={box}
      className={cn('diagram-drawing', className)}
      data-state={state.kind}
      // Mermaid's strict mode sanitises the SVG, and render.ts sanitises it again.
      dangerouslySetInnerHTML={state.kind === 'drawn' ? { __html: state.svg } : undefined}
    >
      {state.kind === 'failed' ? (
        <p className="diagram-error">{state.message}</p>
      ) : state.kind === 'waiting' ? (
        <span className="diagram-waiting" aria-label="Drawing the diagram…" role="status" />
      ) : undefined}
    </div>
  );
}
