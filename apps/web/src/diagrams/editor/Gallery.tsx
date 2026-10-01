import { DIAGRAM_NAMES, type DiagramType } from '@memora/shared';
import { DrawnDiagram } from '../DrawnDiagram';
import { BLANK, TEMPLATES, TEMPLATE_GROUPS } from './templates';

/*
 * Where a new diagram starts (§9.4): a drawn preview of each template, grouped by type,
 * and a blank one of each type that has a visual editor.
 */

export function Gallery({ onPick }: { onPick: (code: string) => void }) {
  return (
    <div className="diagram-gallery">
      {TEMPLATE_GROUPS.map((group) => {
        const templates = TEMPLATES.filter((t) => t.type === group.type);
        const blank = group.type !== 'other' ? BLANK[group.type as DiagramType] : null;
        return (
          <section key={group.type} aria-label={group.name}>
            <h3>{group.name}</h3>
            <div className="diagram-gallery-grid">
              {blank && (
                <button
                  type="button"
                  className="diagram-card is-blank"
                  onClick={() => onPick(blank)}
                >
                  <span className="diagram-card-preview">
                    <span className="diagram-card-plus" aria-hidden>
                      +
                    </span>
                  </span>
                  <span className="diagram-card-name">
                    Blank {DIAGRAM_NAMES[group.type as DiagramType].toLowerCase()}
                  </span>
                </button>
              )}
              {templates.map((template) => (
                <button
                  key={template.name}
                  type="button"
                  className="diagram-card"
                  onClick={() => onPick(template.code)}
                >
                  <span className="diagram-card-preview" aria-hidden>
                    <DrawnDiagram code={template.code} label={template.name} />
                  </span>
                  <span className="diagram-card-name">{template.name}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
