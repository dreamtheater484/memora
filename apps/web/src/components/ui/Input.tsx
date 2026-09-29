import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends ComponentProps<'input'> {
  /** Icon shown inside the field on the left. */
  icon?: ReactNode;
  /** Rounded pill look, used for filters and search fields. */
  pill?: boolean;
  /** Extra content inside the field on the right (a shortcut, a clear button). */
  trailing?: ReactNode;
  invalid?: boolean;
  wrapperClassName?: string;
}

/** Text field. Focus shows an accent ring on the whole field. */
export function Input({
  icon,
  pill,
  trailing,
  invalid,
  className,
  wrapperClassName,
  ...props
}: InputProps) {
  return (
    <div
      data-invalid={invalid || undefined}
      className={cn(
        'flex h-8 items-center gap-2 border border-line bg-surface px-2.5 text-fg-3 transition-[border-color,box-shadow] duration-(--dur-fast)',
        'focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20',
        'data-invalid:border-danger data-invalid:focus-within:ring-danger/20',
        pill ? 'rounded-full' : 'rounded-sm',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        wrapperClassName,
      )}
    >
      {icon}
      <input
        aria-invalid={invalid || undefined}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3',
          className,
        )}
        {...props}
      />
      {trailing}
    </div>
  );
}

export interface FieldProps {
  label: string;
  /** Help text under the field. */
  hint?: ReactNode;
  /** Error message; replaces the hint and marks the field invalid. */
  error?: ReactNode;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Label, field and help or error text, wired together for screen readers. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
      </label>
      {children({ id, describedBy: note ? noteId : undefined, invalid: !!error })}
      {note && (
        <p id={noteId} className={cn('text-xs', error ? 'text-danger' : 'text-fg-3')}>
          {note}
        </p>
      )}
    </div>
  );
}
