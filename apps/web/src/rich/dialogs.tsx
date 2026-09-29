import type { Editor } from '@tiptap/core';
import katex from 'katex';
import { useMemo, useState } from 'react';
import { Button, DialogContent, Field, Input } from '../components/ui';

/*
 * Small dialogs of the rich editor: a link for the selection, and a formula (KaTeX).
 */

export function LinkDialog({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const existing = String(editor.getAttributes('link').href ?? '');
  const empty = editor.state.selection.empty && !existing;
  const [href, setHref] = useState(existing);
  const [text, setText] = useState('');
  const apply = () => {
    let url = href.trim();
    if (!url) return;
    // A bare address is a website.
    if (!/^[a-z][a-z0-9+.-]*:|^[#/]/i.test(url)) url = `https://${url}`;
    const chain = editor.chain().focus();
    if (empty) {
      chain
        .insertContent({
          type: 'text',
          text: text.trim() || url,
          marks: [{ type: 'link', attrs: { href: url } }],
        })
        .run();
    } else chain.extendMarkRange('link').setLink({ href: url }).run();
    onDone();
  };
  return (
    <DialogContent
      title={existing ? 'Edit link' : 'Add a link'}
      footer={
        <>
          {existing && (
            <Button
              variant="danger"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                onDone();
              }}
            >
              Remove link
            </Button>
          )}
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!href.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Field label="Address">
          {({ id }) => (
            <Input
              id={id}
              autoFocus
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
            />
          )}
        </Field>
        {empty && (
          <Field label="Text to show">
            {({ id }) => (
              <Input
                id={id}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Optional"
              />
            )}
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </DialogContent>
  );
}

export interface MathTarget {
  /** The formula's position, or null for a new one. */
  pos: number | null;
  latex: string;
  inline: boolean;
}

export function MathDialog({
  editor,
  target,
  onDone,
}: {
  editor: Editor;
  target: MathTarget;
  onDone: () => void;
}) {
  const [latex, setLatex] = useState(target.latex);
  const preview = useMemo(() => {
    try {
      return {
        html: katex.renderToString(latex || '\\;', {
          displayMode: !target.inline,
          throwOnError: true,
          trust: false,
        }),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Not a valid formula.' };
    }
  }, [latex, target.inline]);
  const save = () => {
    const value = latex.trim();
    const chain = editor.chain().focus();
    if (target.pos === null) {
      if (!value) return onDone();
      if (target.inline) chain.insertInlineMath({ latex: value }).run();
      else chain.insertBlockMath({ latex: value }).run();
    } else if (!value) {
      chain.setNodeSelection(target.pos).deleteSelection().run();
    } else if (target.inline) {
      chain.updateInlineMath({ latex: value, pos: target.pos }).run();
    } else chain.updateBlockMath({ latex: value, pos: target.pos }).run();
    onDone();
  };
  return (
    <DialogContent
      title={target.pos === null ? 'Insert a formula' : 'Edit formula'}
      description="Written in LaTeX, for example \frac{a}{b} or e^{i\pi}."
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {target.pos === null ? 'Insert' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Formula">
          {({ id }) => (
            <textarea
              id={id}
              autoFocus
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  save();
                }
              }}
              rows={3}
              spellCheck={false}
              className="w-full rounded-sm border border-line-strong bg-surface px-2.5 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          )}
        </Field>
        <div
          aria-live="polite"
          className="min-h-12 overflow-x-auto rounded-sm border border-line bg-code px-3 py-2"
        >
          {'html' in preview ? (
            <div dangerouslySetInnerHTML={{ __html: preview.html! }} />
          ) : (
            <p className="text-sm text-danger">{preview.error}</p>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
