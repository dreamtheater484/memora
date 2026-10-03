import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { cn } from '../../lib/cn';
import { EditEpoch } from './epoch';

/*
 * Text fields of the diagram editor's panel (§9.4). Every keystroke changes the drawing, and
 * the code is read back after each change. While a field has the focus it keeps the words as
 * typed (a space at the end, a moment with nothing in it) rather than as the code reads back,
 * and takes the diagram's words again when they change from elsewhere: undo and redo, the code
 * (`EditEpoch` counts those), or when it loses the focus. Labels that can hold line breaks are
 * text areas: Shift+Enter breaks a line.
 */

interface Draft {
  text: string;
  epoch: number;
}

/** A text area as tall as its words (its borders included). */
function fitHeight(area: HTMLTextAreaElement) {
  area.style.height = 'auto';
  const borders = area.offsetHeight - area.clientHeight;
  area.style.height = `${area.scrollHeight + borders}px`;
}

interface TextFieldProps extends Omit<
  ComponentProps<'textarea'>,
  'value' | 'onChange' | 'ref' | 'defaultValue'
> {
  value: string;
  onValueChange: (text: string) => void;
  /** Shift+Enter breaks a line; otherwise the field is one line. */
  multiline?: boolean;
  /** The panel's framed look, or the mind map outline's plain one. */
  variant?: 'framed' | 'plain';
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextField({
  value,
  onValueChange,
  multiline = false,
  variant = 'framed',
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ref,
  ...props
}: TextFieldProps) {
  const epoch = useContext(EditEpoch);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (draft && draft.epoch !== epoch) setDraft({ text: value, epoch });
  const shown = draft && draft.epoch === epoch ? draft.text : value;
  const own = useRef<HTMLTextAreaElement | null>(null);

  // One line grows into more as it is written (and wraps when it is long), and again when the
  // field gets wider or narrower (the panel is laid out, the window resized).
  useLayoutEffect(() => {
    if (own.current) fitHeight(own.current);
  }, [shown]);
  useEffect(() => {
    const area = own.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    let width = area.clientWidth;
    const observer = new ResizeObserver(() => {
      if (area.clientWidth === width) return;
      width = area.clientWidth;
      fitHeight(area);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  return (
    <textarea
      ref={(element) => {
        own.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      rows={1}
      className={cn('diagram-text-field', variant === 'plain' && 'is-plain', className)}
      value={shown}
      onFocus={(e) => {
        setDraft({ text: value, epoch });
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const text = multiline ? e.target.value : e.target.value.replace(/\r?\n/g, ' ');
        setDraft({ text, epoch });
        onValueChange(text);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        // Enter never breaks a line: only Shift+Enter, and only where lines can break.
        if (e.key === 'Enter' && !(multiline && e.shiftKey)) e.preventDefault();
      }}
      {...props}
    />
  );
}

/** A number field that keeps what is typed ("1.", nothing yet) until it is a number. */
export function NumberField({
  value,
  onValueChange,
  className,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  const epoch = useContext(EditEpoch);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (draft && draft.epoch !== epoch) setDraft({ text: String(value), epoch });
  return (
    <input
      inputMode="decimal"
      className={cn('diagram-text-field', className)}
      value={draft && draft.epoch === epoch ? draft.text : String(value)}
      onFocus={(e) => {
        setDraft({ text: String(value), epoch });
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      onChange={(e) => {
        setDraft({ text: e.target.value, epoch });
        const n = Number(e.target.value.replace(',', '.'));
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0) onValueChange(n);
      }}
      {...props}
    />
  );
}
