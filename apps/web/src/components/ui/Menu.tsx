import { Check, ChevronRight, Circle } from 'lucide-react';
import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { floatingPanel, menuItem, menuLabel, menuSeparator } from './styles';

/*
 * Dropdown menus (Menu*) and right-click menus (ContextMenu*) share one look.
 * Both come from Radix, which handles keyboard navigation, type-ahead and focus.
 */

interface ItemExtras {
  icon?: ReactNode;
  /** Shortcut shown on the right, for example "Ctrl D". */
  shortcut?: string;
  /** Destructive action (delete, remove). */
  danger?: boolean;
}

function ItemBody({ icon, shortcut, children }: ItemExtras & { children?: ReactNode }) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 text-xs text-fg-3">{shortcut}</span>}
    </>
  );
}

const dangerItem = 'text-danger [&_svg]:text-danger data-highlighted:bg-danger/10';
const indicatorItem = 'pl-8';
const indicator = 'absolute left-2 inline-flex [&_svg]:text-accent';

/* ---------- Dropdown menu ---------- */

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export const MenuGroup = DM.Group;
export const MenuSub = DM.Sub;
export const MenuRadioGroup = DM.RadioGroup;

export function MenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          floatingPanel,
          'min-w-48 p-1 origin-(--radix-dropdown-menu-content-transform-origin)',
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function MenuItem({
  icon,
  shortcut,
  danger,
  className,
  children,
  ...props
}: ComponentProps<typeof DM.Item> & ItemExtras) {
  return (
    <DM.Item className={cn(menuItem, danger && dangerItem, className)} {...props}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
    </DM.Item>
  );
}

export function MenuCheckboxItem({
  shortcut,
  className,
  children,
  ...props
}: ComponentProps<typeof DM.CheckboxItem> & Omit<ItemExtras, 'icon'>) {
  return (
    <DM.CheckboxItem className={cn(menuItem, indicatorItem, className)} {...props}>
      <DM.ItemIndicator className={indicator}>
        <Check />
      </DM.ItemIndicator>
      <ItemBody shortcut={shortcut}>{children}</ItemBody>
    </DM.CheckboxItem>
  );
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem className={cn(menuItem, indicatorItem, className)} {...props}>
      <DM.ItemIndicator className={indicator}>
        <Circle className="size-2! fill-current" />
      </DM.ItemIndicator>
      <ItemBody>{children}</ItemBody>
    </DM.RadioItem>
  );
}

export function MenuSubTrigger({
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof DM.SubTrigger> & Pick<ItemExtras, 'icon'>) {
  return (
    <DM.SubTrigger className={cn(menuItem, 'data-[state=open]:bg-hover', className)} {...props}>
      <ItemBody icon={icon}>{children}</ItemBody>
      <ChevronRight className="text-fg-3!" />
    </DM.SubTrigger>
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent
        collisionPadding={8}
        className={cn(floatingPanel, 'min-w-44 p-1', className)}
        {...props}
      />
    </DM.Portal>
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn(menuSeparator, className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn(menuLabel, className)} {...props} />;
}

/* ---------- Context menu (right-click, long-press on touch) ---------- */

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;
export const ContextMenuGroup = CM.Group;
export const ContextMenuSub = CM.Sub;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content
        collisionPadding={8}
        className={cn(
          floatingPanel,
          'min-w-48 p-1 origin-(--radix-context-menu-content-transform-origin)',
          className,
        )}
        {...props}
      />
    </CM.Portal>
  );
}

export function ContextMenuItem({
  icon,
  shortcut,
  danger,
  className,
  children,
  ...props
}: ComponentProps<typeof CM.Item> & ItemExtras) {
  return (
    <CM.Item className={cn(menuItem, danger && dangerItem, className)} {...props}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
    </CM.Item>
  );
}

export function ContextMenuSubTrigger({
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof CM.SubTrigger> & Pick<ItemExtras, 'icon'>) {
  return (
    <CM.SubTrigger className={cn(menuItem, 'data-[state=open]:bg-hover', className)} {...props}>
      <ItemBody icon={icon}>{children}</ItemBody>
      <ChevronRight className="text-fg-3!" />
    </CM.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent
        collisionPadding={8}
        className={cn(floatingPanel, 'min-w-44 p-1', className)}
        {...props}
      />
    </CM.Portal>
  );
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof CM.Separator>) {
  return <CM.Separator className={cn(menuSeparator, className)} {...props} />;
}

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof CM.Label>) {
  return <CM.Label className={cn(menuLabel, className)} {...props} />;
}
