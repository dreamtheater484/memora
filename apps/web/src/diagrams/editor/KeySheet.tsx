import type { DiagramType } from '@memora/shared';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { IconButton, Kbd } from '../../components/ui';
import {
  DIAGRAM_KEY_GROUPS,
  DIAGRAM_KEYS,
  keysLabel,
  type DiagramKeyGroup,
} from '../../shell/shortcuts';

/*
 * The diagram editor's keys (§9.4), shown over the drawing with ?: those of every diagram,
 * this kind's own and the panel's.
 */

const GROUP_OF: Partial<Record<DiagramType, DiagramKeyGroup>> = {
  flowchart: 'flowchart',
  mindmap: 'mindmap',
  sequence: 'sequence',
  timeline: 'charts',
  gantt: 'charts',
  pie: 'charts',
};

export function KeySheet({ type, onClose }: { type: DiagramType | 'other'; onClose: () => void }) {
  const own = type === 'other' ? undefined : GROUP_OF[type];
  const groups: DiagramKeyGroup[] = ['all', ...(own ? [own] : []), 'panel'];
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
  }, []);
  return (
    <div
      ref={sheet}
      className="diagram-key-sheet"
      role="dialog"
      aria-label="Keys of the diagram editor"
      tabIndex={-1}
    >
      <div className="diagram-key-sheet-head">
        <h2>Keys</h2>
        <IconButton label="Close" shortcut="Esc" icon={<X />} size="sm" onClick={onClose} />
      </div>
      <div className="diagram-key-sheet-body">
        {groups.map((group) => (
          <section key={group}>
            <h3>{DIAGRAM_KEY_GROUPS[group]}</h3>
            <dl>
              {DIAGRAM_KEYS.filter((k) => k.group === group).map((k) => (
                <div key={`${k.keys}-${k.label}`}>
                  <dt>
                    {keysLabel(k.keys)
                      .split(' ')
                      .map((key, i) => (
                        <Kbd key={i}>{key}</Kbd>
                      ))}
                  </dt>
                  <dd>{k.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
