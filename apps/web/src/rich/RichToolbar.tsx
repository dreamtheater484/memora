import {
  CALLOUT_KINDS,
  RICH_FILL_COLORS,
  RICH_FONTS,
  RICH_FONT_SIZES,
  RICH_LINE_SPACINGS,
  RICH_TEXT_COLORS,
  richFontLabel,
  type CalloutKind,
} from '@memora/shared';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Calendar,
  CheckSquare,
  ChevronDown,
  Code2,
  Columns3,
  Ellipsis,
  FileUp,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  Link2,
  List,
  ListChevronsUpDown,
  ListOrdered,
  Merge,
  Minus,
  PaintBucket,
  Redo2,
  RemoveFormatting,
  Rows3,
  Sigma,
  Split,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableProperties,
  Trash2,
  Underline,
  Undo2,
  WrapText,
} from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui';
import { TablePicker } from '../editor/TablePicker';
import { cn } from '../lib/cn';
import { useWidth } from '../lib/useWidth';
import { keysLabel } from '../shell/shortcuts';
import { insertFiles } from './files';
import type { RichHost } from './host';

/*
 * The rich page toolbar (§9.4): Word-like, grouped Home / Insert / Table. It is one row: on a
 * narrow pane the tabs go and the less used tools move into the "More" menu, which always has
 * everything, so nothing is ever out of reach.
 */

type Tab = 'home' | 'insert' | 'table';

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const STYLES = [
  { id: 'paragraph', label: 'Normal text' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
  { id: 'h4', label: 'Heading 4' },
  { id: 'codeBlock', label: 'Code' },
] as const;
type StyleId = (typeof STYLES)[number]['id'];

const CALLOUT_LABELS: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const ALIGNS = [
  { value: 'left', label: 'Align left', icon: <AlignLeft />, keys: 'Mod Shift L' },
  { value: 'center', label: 'Centre', icon: <AlignCenter />, keys: 'Mod Shift E' },
  { value: 'right', label: 'Align right', icon: <AlignRight />, keys: 'Mod Shift R' },
  { value: 'justify', label: 'Justify', icon: <AlignJustify />, keys: 'Mod Shift J' },
] as const;

function styleOf(editor: Editor): StyleId {
  if (editor.isActive('codeBlock')) return 'codeBlock';
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive('heading', { level })) return `h${level}`;
  }
  return 'paragraph';
}

function setStyle(editor: Editor, id: StyleId) {
  const chain = editor.chain().focus();
  if (id === 'paragraph') chain.setParagraph().run();
  else if (id === 'codeBlock') chain.toggleCodeBlock().run();
  else chain.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 | 4 }).run();
}

/** The kind of list item the cursor is in, if any. */
const listItemType = (editor: Editor) =>
  editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;

/** Indents (or outdents) as Tab does: a list item a level, else paragraphs a step. */
function indent(editor: Editor, forward: boolean) {
  const list = listItemType(editor);
  const chain = editor.chain().focus();
  if (list) (forward ? chain.sinkListItem(list) : chain.liftListItem(list)).run();
  else (forward ? chain.indent() : chain.outdent()).run();
}

/** What the toolbar shows as on, read from the editor on each change. */
function useToolbarState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const style = e.getAttributes('textStyle');
      return {
        style: styleOf(e),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        subscript: e.isActive('subscript'),
        superscript: e.isActive('superscript'),
        link: e.isActive('link'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        align:
          (['left', 'center', 'right', 'justify'] as const).find((a) =>
            e.isActive({ textAlign: a }),
          ) ?? 'left',
        spacing: (e.getAttributes('paragraph').lineSpacing ??
          e.getAttributes('heading').lineSpacing ??
          null) as number | null,
        font: (style.fontFamily as string | undefined) ?? null,
        size: (style.fontSize as string | undefined) ?? null,
        color: (style.color as string | undefined) ?? null,
        highlight: (e.getAttributes('highlight').color as string | undefined) ?? null,
        inTable: e.isActive('table'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canMerge: e.can().mergeCells(),
        canSplit: e.can().splitCell(),
        // Indent moves a list item a level, or a paragraph or heading a step (as Tab does).
        canSink: listItemType(e) ? e.can().sinkListItem(listItemType(e)!) : e.can().indent(),
        canLift: listItemType(e) ? e.can().liftListItem(listItemType(e)!) : e.can().outdent(),
      };
    },
  });
}

type State = NonNullable<ReturnType<typeof useToolbarState>>;

function Tool({
  label,
  icon,
  keys,
  onRun,
  active,
  disabled,
  show,
}: {
  label: string;
  icon: ReactNode;
  keys?: string;
  onRun: () => void;
  active?: boolean;
  disabled?: boolean;
  /** The narrowest toolbar (in rem) that still shows it; narrower ones have it in "More". */
  show?: number;
}) {
  const button = (
    <IconButton
      label={label}
      icon={icon}
      size="sm"
      shortcut={keys ? keysLabel(keys) : undefined}
      active={active}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onRun}
      aria-pressed={active}
    />
  );
  return show ? <span className={WIDTH[show]}>{button}</span> : button;
}

/** Tailwind needs whole class names: one per width a tool can appear at. */
const WIDTH: Record<number, string> = {
  24: 'hidden @min-[24rem]:contents',
  30: 'hidden @min-[30rem]:contents',
  36: 'hidden @min-[36rem]:contents',
  42: 'hidden @min-[42rem]:contents',
  48: 'hidden @min-[48rem]:contents',
  54: 'hidden @min-[54rem]:contents',
  60: 'hidden @min-[60rem]:contents',
  66: 'hidden @min-[66rem]:contents',
};

const Divider = ({ show }: { show?: number }) => (
  <span
    aria-hidden
    className={cn(
      'mx-1 h-4 w-px shrink-0 bg-line-strong',
      show && WIDTH[show]?.replace('contents', 'block'),
    )}
  />
);

/** Colour swatches; `null` is the page's own colour. */
function Swatches({
  colors,
  value,
  onPick,
  none,
}: {
  colors: readonly { label: string; value: string }[];
  value: string | null;
  onPick: (color: string | null) => void;
  none: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Colours">
        {colors.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-label={c.label}
            aria-pressed={value === c.value}
            title={c.label}
            onMouseDown={keepFocus}
            onClick={() => onPick(c.value)}
            className={cn(
              'size-7 rounded-sm border border-line-strong',
              value === c.value && 'ring-2 ring-accent ring-offset-1 ring-offset-surface',
            )}
            style={{ background: c.value }}
          />
        ))}
      </div>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onPick(null)}
        className="rounded-sm px-2 py-1 text-left text-sm hover:bg-hover"
      >
        {none}
      </button>
    </div>
  );
}

function ColourTool({
  label,
  icon,
  colors,
  value,
  none,
  onPick,
  show,
}: {
  label: string;
  icon: ReactNode;
  colors: readonly { label: string; value: string }[];
  value: string | null;
  none: string;
  onPick: (color: string | null) => void;
  show?: number;
}) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          label={label}
          size="sm"
          onMouseDown={keepFocus}
          icon={
            <span className="relative inline-flex">
              {icon}
              <span
                aria-hidden
                className="absolute -bottom-0.5 left-0 h-[3px] w-full rounded-full"
                style={{ background: value ?? 'transparent' }}
              />
            </span>
          }
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2.5" onCloseAutoFocus={(e) => e.preventDefault()}>
        <Swatches
          colors={colors}
          value={value}
          none={none}
          onPick={(color) => {
            setOpen(false);
            onPick(color);
          }}
        />
      </PopoverContent>
    </Popover>
  );
  return show ? <span className={WIDTH[show]}>{trigger}</span> : trigger;
}

/** A small dropdown showing its current value, like Word's style and font boxes. */
function Dropdown({
  label,
  value,
  icon,
  width,
  show,
  children,
}: {
  label: string;
  value?: string;
  /** Shown instead of a value. */
  icon?: ReactNode;
  width: string;
  show?: number;
  children: ReactNode;
}) {
  const menu = (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onMouseDown={keepFocus}
          className={cn(
            'inline-flex h-7 shrink-0 items-center justify-between gap-1 rounded-sm px-2 text-sm text-fg hover:bg-hover aria-expanded:bg-hover',
            width,
          )}
        >
          {icon ? (
            <span aria-hidden className="inline-flex text-fg-2 [&_svg]:size-4">
              {icon}
            </span>
          ) : (
            <span className="truncate">{value}</span>
          )}
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-3" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="max-h-80 overflow-y-auto">
        {children}
      </MenuContent>
    </Menu>
  );
  return show ? <span className={WIDTH[show]}>{menu}</span> : menu;
}

/** The font of text without one: the page's default (Settings → Editing), or Memora's. */
const fontLabel = (value: string | null, defaults: RichDefaults) =>
  richFontLabel(value ?? defaults.font) || 'Figtree';

/** Text without a font or size of its own has these (Settings → Editing). */
export interface RichDefaults {
  /** A CSS font family, or '' for Memora's own. */
  font: string;
  /** In points. */
  size: number;
}

/** The browser can list the computer's own fonts (Chromium, and the desktop app). */
const canListFonts = () => typeof window !== 'undefined' && 'queryLocalFonts' in window;

export interface RichToolbarProps {
  editor: Editor | null;
  host: RichHost;
  defaults: RichDefaults;
  /** Two rows rather than tools in "More" (not while a phone's keyboard is open). */
  wrap?: boolean;
  /** On the right: the page view and the outline. */
  end?: ReactNode;
}

export const RichToolbar = memo(function RichToolbar({
  editor,
  host,
  defaults,
  wrap = true,
  end,
}: RichToolbarProps) {
  const state = useToolbarState(editor);
  const [tab, setTab] = useState<Tab>('home');
  const [tableOpen, setTableOpen] = useState(false);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const width = useWidth(box);
  // Narrow toolbars have no tabs: Home, with the rest under "More".
  const narrow = width > 0 && width < 640;
  if (!editor || !state) return <div ref={setBox} className="flex-1" />;
  const chain = () => editor.chain().focus();
  const pick = (images: boolean) => () =>
    void host.pickFiles(images).then((files) => insertFiles(editor, files, host));
  const shown = narrow || (tab === 'table' && !state.inTable) ? 'home' : tab;
  // On one row (a phone's keyboard is open), tools move into "More" as the row narrows. Else
  // the toolbar wraps onto a second row, and only the less used tools move.
  const at = (single: number, wrapped?: number) => (wrap ? wrapped : single);
  // Tools that belong together wrap together.
  const group = wrap ? 'flex items-center gap-0.5' : 'contents';

  const home = (
    <>
      <span className={group}>
        <Tool
          label="Undo"
          icon={<Undo2 />}
          keys="Mod Z"
          onRun={() => chain().undo().run()}
          disabled={!state.canUndo}
          show={at(42, 36)}
        />
        <Tool
          label="Redo"
          icon={<Redo2 />}
          keys="Mod Shift Z"
          onRun={() => chain().redo().run()}
          disabled={!state.canRedo}
          show={at(42, 36)}
        />
        <Divider show={at(42, 36)} />
      </span>
      <span className={group}>
        <Dropdown
          label="Text style"
          value={STYLES.find((s) => s.id === state.style)!.label}
          width="w-[7.5rem]"
          show={at(30)}
        >
          <MenuRadioGroup value={state.style} onValueChange={(v) => setStyle(editor, v as StyleId)}>
            {STYLES.map((s) => (
              <MenuRadioItem key={s.id} value={s.id}>
                {s.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Dropdown>
        <Dropdown
          label="Font"
          value={fontLabel(state.font, defaults)}
          width="w-[7rem]"
          show={at(60)}
        >
          <FontItems editor={editor} value={state.font} host={host} />
        </Dropdown>
        <Dropdown
          label="Font size"
          value={state.size ? state.size.replace('pt', '') : String(defaults.size)}
          width="w-[3.5rem]"
          show={at(60)}
        >
          <SizeItems editor={editor} value={state.size} defaultSize={defaults.size} />
        </Dropdown>
        <Divider show={at(30)} />
      </span>
      <span className={group}>
        <Tool
          label="Bold"
          icon={<Bold />}
          keys="Mod B"
          active={state.bold}
          onRun={() => chain().toggleBold().run()}
        />
        <Tool
          label="Italic"
          icon={<Italic />}
          keys="Mod I"
          active={state.italic}
          onRun={() => chain().toggleItalic().run()}
        />
        <Tool
          label="Underline"
          icon={<Underline />}
          keys="Mod U"
          active={state.underline}
          onRun={() => chain().toggleUnderline().run()}
        />
        <Tool
          label="Strikethrough"
          icon={<Strikethrough />}
          keys="Mod Shift S"
          active={state.strike}
          onRun={() => chain().toggleStrike().run()}
          show={at(36)}
        />
        <Tool
          label="Subscript"
          icon={<Subscript />}
          keys="Mod ,"
          active={state.subscript}
          onRun={() => chain().toggleSubscript().run()}
          show={at(66, 48)}
        />
        <Tool
          label="Superscript"
          icon={<Superscript />}
          keys="Mod ."
          active={state.superscript}
          onRun={() => chain().toggleSuperscript().run()}
          show={at(66, 48)}
        />
        <ColourTool
          label="Text colour"
          icon={<Baseline />}
          colors={RICH_TEXT_COLORS}
          value={state.color}
          none="Automatic"
          onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())}
          show={at(42)}
        />
        <ColourTool
          label="Highlight"
          icon={<Highlighter />}
          colors={RICH_FILL_COLORS}
          value={state.highlight}
          none="No highlight"
          onPick={(c) =>
            c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run()
          }
          show={at(42)}
        />
        <Tool
          label="Clear formatting"
          icon={<RemoveFormatting />}
          keys="Ctrl Space"
          onRun={() => chain().unsetAllMarks().run()}
          show={at(66, 42)}
        />
        <Divider show={at(36)} />
      </span>
      <span className={group}>
        <Dropdown
          label="Alignment"
          icon={ALIGNS.find((a) => a.value === state.align)!.icon}
          width="w-12 px-1.5!"
          show={at(48)}
        >
          {ALIGNS.map((a) => (
            <MenuItem
              key={a.value}
              icon={a.icon}
              shortcut={keysLabel(a.keys)}
              onSelect={() => chain().setTextAlign(a.value).run()}
            >
              {a.label}
            </MenuItem>
          ))}
        </Dropdown>
        <Dropdown
          label="Line spacing"
          icon={<ListChevronsUpDown />}
          width="w-12 px-1.5!"
          show={at(66, 48)}
        >
          <SpacingItems editor={editor} value={state.spacing} />
        </Dropdown>
        <Tool
          label="Bullet list"
          icon={<List />}
          keys="Mod Shift 8"
          active={state.bullet}
          onRun={() => chain().toggleBulletList().run()}
          show={at(24)}
        />
        <Tool
          label="Numbered list"
          icon={<ListOrdered />}
          keys="Mod Shift 7"
          active={state.ordered}
          onRun={() => chain().toggleOrderedList().run()}
          show={at(30)}
        />
        <Tool
          label="Task list"
          icon={<CheckSquare />}
          keys="Mod Shift 9"
          active={state.task}
          onRun={() => chain().toggleTaskList().run()}
          show={at(36)}
        />
        <Tool
          label="Decrease indent"
          icon={<IndentDecrease />}
          keys="Shift Tab"
          disabled={!state.canLift}
          onRun={() => indent(editor, false)}
          show={at(60)}
        />
        <Tool
          label="Increase indent"
          icon={<IndentIncrease />}
          keys="Tab"
          disabled={!state.canSink}
          onRun={() => indent(editor, true)}
          show={at(60)}
        />
        <Tool
          label="Link"
          icon={<Link2 />}
          keys="Mod K"
          active={state.link}
          onRun={() => host.editLink()}
          show={at(24)}
        />
      </span>
    </>
  );

  const insert = (
    <>
      <Popover open={tableOpen} onOpenChange={setTableOpen}>
        <PopoverTrigger asChild>
          <IconButton
            label="Insert table"
            icon={<Table />}
            size="sm"
            onMouseDown={keepFocus}
            active={tableOpen}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
          <TablePicker
            onPick={(cols, rows) => {
              setTableOpen(false);
              chain()
                .insertTable({ rows: rows + 1, cols, withHeaderRow: true })
                .run();
            }}
          />
        </PopoverContent>
      </Popover>
      <Tool label="Image" icon={<ImagePlus />} onRun={pick(true)} />
      <Tool label="File" icon={<FileUp />} onRun={pick(false)} show={at(24)} />
      <Tool label="Link" icon={<Link2 />} keys="Mod K" onRun={() => host.editLink()} />
      <Divider show={at(30)} />
      <Tool
        label="Note box"
        icon={<Info />}
        onRun={() => chain().setCallout('note').run()}
        show={at(30)}
      />
      <Tool
        label="Code block"
        icon={<Code2 />}
        keys="Mod Alt C"
        onRun={() => chain().toggleCodeBlock().run()}
        show={at(30)}
      />
      <Tool
        label="Formula"
        icon={<Sigma />}
        onRun={() => host.editMath({ pos: null, latex: '', inline: false })}
        show={at(36)}
      />
      <Tool
        label="Divider"
        icon={<Minus />}
        onRun={() => chain().setHorizontalRule().run()}
        show={at(36)}
      />
      <Tool
        label="Line break"
        icon={<WrapText />}
        keys="Shift Enter"
        onRun={() => chain().setHardBreak().run()}
        show={at(42)}
      />
      <Tool
        label="Today’s date"
        icon={<Calendar />}
        onRun={() =>
          chain()
            .insertContent(
              new Date().toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              }),
            )
            .run()
        }
        show={at(42)}
      />
    </>
  );

  const table = (
    <>
      <Tool label="Row above" icon={<Rows3 />} onRun={() => chain().addRowBefore().run()} />
      <Tool label="Row below" icon={<Rows3 />} onRun={() => chain().addRowAfter().run()} />
      <Tool
        label="Column on the left"
        icon={<Columns3 />}
        onRun={() => chain().addColumnBefore().run()}
        show={at(24)}
      />
      <Tool
        label="Column on the right"
        icon={<Columns3 />}
        onRun={() => chain().addColumnAfter().run()}
        show={at(24)}
      />
      <Divider show={at(30)} />
      <Tool
        label="Merge cells"
        icon={<Merge />}
        disabled={!state.canMerge}
        onRun={() => chain().mergeCells().run()}
        show={at(30)}
      />
      <Tool
        label="Split cell"
        icon={<Split />}
        disabled={!state.canSplit}
        onRun={() => chain().splitCell().run()}
        show={at(30)}
      />
      <Tool
        label="Header row"
        icon={<TableProperties />}
        onRun={() => chain().toggleHeaderRow().run()}
        show={at(36)}
      />
      <ColourTool
        label="Cell colour"
        icon={<PaintBucket />}
        colors={RICH_FILL_COLORS}
        value={null}
        none="No colour"
        onPick={(c) => chain().setCellAttribute('backgroundColor', c).run()}
        show={at(36)}
      />
      <Divider show={at(42)} />
      <Tool
        label="Delete row"
        icon={<Trash2 />}
        onRun={() => chain().deleteRow().run()}
        show={at(42)}
      />
      <Tool
        label="Delete column"
        icon={<Trash2 />}
        onRun={() => chain().deleteColumn().run()}
        show={at(48)}
      />
      <Tool
        label="Delete table"
        icon={<Trash2 />}
        onRun={() => chain().deleteTable().run()}
        show={at(54)}
      />
    </>
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'insert', label: 'Insert' },
    ...(state.inTable ? [{ id: 'table' as const, label: 'Table' }] : []),
  ];

  return (
    <div className={cn('flex min-w-0 flex-1 gap-1', wrap ? 'items-start' : 'items-center')}>
      <div
        ref={setBox}
        className={cn(
          '@container flex min-w-0 flex-1 gap-1',
          wrap ? 'items-start' : 'items-center',
        )}
      >
        {!narrow && (
          <div
            role="tablist"
            aria-label="Toolbar"
            className="mr-1 flex shrink-0 items-center gap-0.5"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={shown === t.id}
                onMouseDown={keepFocus}
                onClick={() => setTab(t.id)}
                className={cn(
                  'h-7 rounded-sm px-2 text-xs font-semibold text-fg-2 hover:bg-hover hover:text-fg',
                  shown === t.id && 'bg-hover text-fg',
                  t.id === 'table' && 'text-accent',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div
          role="toolbar"
          aria-label="Formatting"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-0.5',
            wrap ? 'flex-wrap gap-y-1' : 'overflow-hidden',
          )}
        >
          {shown === 'home' ? home : shown === 'insert' ? insert : table}
          <MoreMenu editor={editor} state={state} host={host} defaults={defaults} onPick={pick} />
        </div>
      </div>
      {end}
    </div>
  );
});

function FontItems({
  editor,
  value,
  host,
}: {
  editor: Editor;
  value: string | null;
  host: RichHost;
}) {
  // A font of the computer's own, set from its list: shown as the current one.
  const own = value && !RICH_FONTS.some((f) => f.value === value) ? value : null;
  return (
    <>
      <MenuRadioGroup
        value={value ?? ''}
        onValueChange={(v) =>
          v
            ? editor.chain().focus().setFontFamily(v).run()
            : editor.chain().focus().unsetFontFamily().run()
        }
      >
        <MenuRadioItem value="">Default font</MenuRadioItem>
        {RICH_FONTS.map((f) => (
          <MenuRadioItem key={f.value} value={f.value}>
            <span style={{ fontFamily: f.value }}>{f.label}</span>
          </MenuRadioItem>
        ))}
        {own && (
          <MenuRadioItem value={own}>
            <span style={{ fontFamily: own }}>{richFontLabel(own)}</span>
          </MenuRadioItem>
        )}
      </MenuRadioGroup>
      {canListFonts() && (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => host.pickFont()}>This computer’s fonts…</MenuItem>
        </>
      )}
    </>
  );
}

function SizeItems({
  editor,
  value,
  defaultSize,
}: {
  editor: Editor;
  value: string | null;
  defaultSize: number;
}) {
  const unset = `${defaultSize}pt`;
  return (
    <MenuRadioGroup
      value={value ?? unset}
      onValueChange={(v) =>
        v === unset
          ? editor.chain().focus().unsetFontSize().run()
          : editor.chain().focus().setFontSize(v).run()
      }
    >
      {RICH_FONT_SIZES.map((size) => (
        <MenuRadioItem key={size} value={`${size}pt`}>
          {size}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}

function SpacingItems({ editor, value }: { editor: Editor; value: number | null }) {
  return (
    <MenuRadioGroup
      value={value === null ? '' : String(value)}
      onValueChange={(v) =>
        editor
          .chain()
          .focus()
          .setLineSpacing(v ? Number(v) : null)
          .run()
      }
    >
      <MenuRadioItem value="">Default spacing</MenuRadioItem>
      {RICH_LINE_SPACINGS.map((s) => (
        <MenuRadioItem key={s} value={String(s)}>
          {s === 1 ? 'Single' : s === 2 ? 'Double' : s.toFixed(2).replace(/0$/, '')}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}

/** Everything the toolbar can do, for when it hasn't room to show it all. */
function MoreMenu({
  editor,
  state,
  host,
  defaults,
  onPick,
}: {
  editor: Editor;
  state: State;
  host: RichHost;
  defaults: RichDefaults;
  onPick: (images: boolean) => () => void;
}) {
  const chain = () => editor.chain().focus();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="More" icon={<Ellipsis />} size="sm" onMouseDown={keepFocus} />
      </MenuTrigger>
      <MenuContent align="start" className="max-h-[70dvh] overflow-y-auto">
        <MenuLabel>Home</MenuLabel>
        <MenuSub>
          <MenuSubTrigger>Text style</MenuSubTrigger>
          <MenuSubContent>
            <MenuRadioGroup
              value={state.style}
              onValueChange={(v) => setStyle(editor, v as StyleId)}
            >
              {STYLES.map((s) => (
                <MenuRadioItem key={s.id} value={s.id}>
                  {s.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Font</MenuSubTrigger>
          <MenuSubContent>
            <FontItems editor={editor} value={state.font} host={host} />
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Font size</MenuSubTrigger>
          <MenuSubContent className="max-h-72 overflow-y-auto">
            <SizeItems editor={editor} value={state.size} defaultSize={defaults.size} />
          </MenuSubContent>
        </MenuSub>
        <MenuCheckboxItem
          checked={state.strike}
          onCheckedChange={() => chain().toggleStrike().run()}
        >
          Strikethrough
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={state.subscript}
          onCheckedChange={() => chain().toggleSubscript().run()}
        >
          Subscript
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={state.superscript}
          onCheckedChange={() => chain().toggleSuperscript().run()}
        >
          Superscript
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={state.code} onCheckedChange={() => chain().toggleCode().run()}>
          Inline code
        </MenuCheckboxItem>
        <MenuSub>
          <MenuSubTrigger icon={<Baseline />}>Text colour</MenuSubTrigger>
          <MenuSubContent className="p-2.5">
            <Swatches
              colors={RICH_TEXT_COLORS}
              value={state.color}
              none="Automatic"
              onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())}
            />
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger icon={<Highlighter />}>Highlight</MenuSubTrigger>
          <MenuSubContent className="p-2.5">
            <Swatches
              colors={RICH_FILL_COLORS}
              value={state.highlight}
              none="No highlight"
              onPick={(c) =>
                c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run()
              }
            />
          </MenuSubContent>
        </MenuSub>
        <MenuItem icon={<RemoveFormatting />} onSelect={() => chain().unsetAllMarks().run()}>
          Clear formatting
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger icon={<AlignLeft />}>Alignment</MenuSubTrigger>
          <MenuSubContent>
            {ALIGNS.map((a) => (
              <MenuItem
                key={a.value}
                icon={a.icon}
                onSelect={() => chain().setTextAlign(a.value).run()}
              >
                {a.label}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger icon={<ListChevronsUpDown />}>Line spacing</MenuSubTrigger>
          <MenuSubContent>
            <SpacingItems editor={editor} value={state.spacing} />
          </MenuSubContent>
        </MenuSub>
        <MenuItem icon={<List />} onSelect={() => chain().toggleBulletList().run()}>
          Bullet list
        </MenuItem>
        <MenuItem icon={<ListOrdered />} onSelect={() => chain().toggleOrderedList().run()}>
          Numbered list
        </MenuItem>
        <MenuItem icon={<CheckSquare />} onSelect={() => chain().toggleTaskList().run()}>
          Task list
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Insert</MenuLabel>
        <MenuItem
          icon={<Table />}
          onSelect={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          Table
        </MenuItem>
        <MenuItem icon={<ImagePlus />} onSelect={onPick(true)}>
          Image…
        </MenuItem>
        <MenuItem icon={<FileUp />} onSelect={onPick(false)}>
          File…
        </MenuItem>
        <MenuItem icon={<Link2 />} shortcut={keysLabel('Mod K')} onSelect={() => host.editLink()}>
          Link…
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger icon={<Info />}>Callout box</MenuSubTrigger>
          <MenuSubContent>
            {CALLOUT_KINDS.map((kind) => (
              <MenuItem key={kind} onSelect={() => chain().setCallout(kind).run()}>
                {CALLOUT_LABELS[kind]}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuItem icon={<Code2 />} onSelect={() => chain().toggleCodeBlock().run()}>
          Code block
        </MenuItem>
        <MenuItem
          icon={<Sigma />}
          onSelect={() => host.editMath({ pos: null, latex: '', inline: false })}
        >
          Formula…
        </MenuItem>
        <MenuItem
          icon={<Sigma />}
          onSelect={() => host.editMath({ pos: null, latex: '', inline: true })}
        >
          Formula in the text…
        </MenuItem>
        <MenuItem icon={<Minus />} onSelect={() => chain().setHorizontalRule().run()}>
          Divider
        </MenuItem>
        {state.inTable && (
          <>
            <MenuSeparator />
            <MenuLabel>Table</MenuLabel>
            <TableMenuItems editor={editor} state={state} />
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

/** Table commands, for the toolbar's menu and the right-click menu. */
export function TableMenuItems({
  editor,
  state,
}: {
  editor: Editor;
  state: Pick<State, 'canMerge' | 'canSplit'>;
}) {
  const Item = MenuItem;
  const chain = () => editor.chain().focus();
  return (
    <>
      <Item icon={<Rows3 />} onSelect={() => chain().addRowBefore().run()}>
        Row above
      </Item>
      <Item icon={<Rows3 />} onSelect={() => chain().addRowAfter().run()}>
        Row below
      </Item>
      <Item icon={<Columns3 />} onSelect={() => chain().addColumnBefore().run()}>
        Column on the left
      </Item>
      <Item icon={<Columns3 />} onSelect={() => chain().addColumnAfter().run()}>
        Column on the right
      </Item>
      <Item icon={<Merge />} disabled={!state.canMerge} onSelect={() => chain().mergeCells().run()}>
        Merge cells
      </Item>
      <Item icon={<Split />} disabled={!state.canSplit} onSelect={() => chain().splitCell().run()}>
        Split cell
      </Item>
      <Item icon={<TableProperties />} onSelect={() => chain().toggleHeaderRow().run()}>
        Header row on or off
      </Item>
      <Item icon={<Trash2 />} danger onSelect={() => chain().deleteRow().run()}>
        Delete row
      </Item>
      <Item icon={<Trash2 />} danger onSelect={() => chain().deleteColumn().run()}>
        Delete column
      </Item>
      <Item icon={<Trash2 />} danger onSelect={() => chain().deleteTable().run()}>
        Delete table
      </Item>
    </>
  );
}
