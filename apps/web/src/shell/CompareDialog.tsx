import { useMemo, useState } from 'react';
import { Button, DialogContent } from '../components/ui';
import { cn } from '../lib/cn';
import { comparePage, type Choice } from '../sync/compare';
import type { PageDoc } from '../sync/doc';
import { useDocSnapshot } from '../sync/hooks';

/*
 * Comparing a page's two versions after a conflict (§9.6), loaded when it is opened.
 */

const sideLabel: Record<'theirs' | 'mine', string> = {
  theirs: 'On the server',
  mine: 'On this device',
};

/** Side by side, choosing per change: the server's version, this device's, or both. */
export default function CompareDialog({ doc, onDone }: { doc: PageDoc; onDone: () => void }) {
  const snapshot = useDocSnapshot(doc);
  const conflict = snapshot?.record?.conflict;
  const theirs = conflict?.content ?? '';
  const mine = snapshot?.record?.content ?? '';
  const type = snapshot?.record?.type ?? 'markdown';
  const comparison = useMemo(() => comparePage(type, theirs, mine), [type, theirs, mine]);
  const blocks = comparison?.blocks ?? [];
  const changes = blocks.filter((b) => b.kind === 'change').length;
  const [choices, setChoices] = useState<Choice[]>(() => Array(changes).fill('mine'));
  const choose = (i: number, choice: Choice) =>
    setChoices((all) => all.map((c, j) => (j === i ? choice : c)));

  let change = -1;
  return (
    <DialogContent
      size="xl"
      title="Compare versions"
      description="Where the two versions differ, choose which text to keep. Unchanged text stays as it is."
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!comparison}
            onClick={() => {
              if (comparison) void doc.keepMine(comparison.compose(choices));
              onDone();
            }}
          >
            Save this version
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {blocks.map((block, index) => {
          if (block.kind === 'same') {
            const lines = block.text.replace(/\n$/, '').split('\n');
            return (
              <pre
                key={index}
                className="max-h-24 overflow-hidden px-1 font-mono text-xs whitespace-pre-wrap text-fg-3"
              >
                {lines.length > 4
                  ? `${lines.slice(0, 2).join('\n')}\n… ${lines.length - 4} unchanged lines …\n${lines.slice(-2).join('\n')}`
                  : lines.join('\n')}
              </pre>
            );
          }
          const i = ++change;
          const chosen = choices[i] ?? 'mine';
          return (
            <fieldset key={index} className="rounded-md border border-line-strong p-2.5">
              <legend className="px-1 text-xs font-semibold text-fg-2">
                Change {i + 1} of {changes}
              </legend>
              <div className="grid gap-2 tablet:grid-cols-2">
                {(['theirs', 'mine'] as const).map((side) => (
                  <label
                    key={side}
                    className={cn(
                      'flex cursor-pointer flex-col gap-1.5 rounded-sm border p-2.5',
                      chosen === side || chosen === 'both'
                        ? 'border-accent bg-accent/7'
                        : 'border-line',
                    )}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      <input
                        type="radio"
                        name={`change-${i}`}
                        checked={chosen === side}
                        onChange={() => choose(i, side)}
                        className="accent-(--accent)"
                      />
                      {sideLabel[side]}
                    </span>
                    <pre className="font-mono text-xs whitespace-pre-wrap text-fg">
                      {block[side] || <i className="font-sans text-fg-3">(nothing)</i>}
                    </pre>
                  </label>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-fg-2">
                <input
                  type="radio"
                  name={`change-${i}`}
                  checked={chosen === 'both'}
                  onChange={() => choose(i, 'both')}
                  className="accent-(--accent)"
                />
                Keep both, the server’s first
              </label>
            </fieldset>
          );
        })}
      </div>
    </DialogContent>
  );
}
