import { Check, ChevronsUpDown } from 'lucide-react';
import { Select as S } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { floatingPanel, menuItem } from './styles';

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** Single-choice dropdown with full keyboard support. */
export function Select({ options, placeholder, className, id, ...props }: SelectProps) {
  return (
    <S.Root {...props}>
      <S.Trigger
        id={id}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
        className={cn(
          'inline-flex h-8 min-w-36 items-center justify-between gap-2 rounded-sm border border-line bg-surface pr-2 pl-3 text-sm text-fg',
          'hover:border-line-strong data-placeholder:text-fg-3 disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon className="text-fg-3">
          <ChevronsUpDown />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            floatingPanel,
            'max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin)',
          )}
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={cn(menuItem, 'pr-8')}
              >
                {o.icon}
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="absolute right-2 inline-flex text-accent">
                  <Check />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
