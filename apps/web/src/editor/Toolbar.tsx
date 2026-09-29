import type { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { formatAllTables } from '@memora/shared';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpZA,
  Bold,
  Calendar,
  Code,
  Columns3,
  Ellipsis,
  FileUp,
  Grid3x3,
  Heading,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Network,
  Quote,
  Rows3,
  Search,
  Sigma,
  SquareCode,
  Strikethrough,
  Table,
  TriangleAlert,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui';
import { cn } from '../lib/cn';
import { keysLabel } from '../shell/shortcuts';
import {
  insertCallout,
  insertCodeBlock,
  insertDate,
  insertLink,
  insertMath,
  insertMermaid,
  insertRule,
  setHeading,
  toggleList,
  toggleQuote,
  toggleWrap,
} from './commands';
import { TablePicker } from './TablePicker';
import { insertTable, tableCommands } from './tables';
import { textChange } from '../sync/merge';

/*
 * The Markdown toolbar (§9.3): the common formatting as buttons, everything else in a menu.
 * Groups move into the menu as the space gets narrow, so nothing is ever out of reach.
 */

export interface ToolbarProps {
  view: EditorView | null;
  /** Whether the cursor is in a table (shows the table commands). */
  inTable: boolean;
  onPickFile: (images: boolean) => void;
  onGridEditor: () => void;
  /** On the right: the view switch and the outline button. */
  end?: ReactNode;
}

/** Keeps the editor's selection: toolbar buttons never take the focus from it. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function Tool({
  label,
  icon,
  shortcut,
  onRun,
  className,
}: {
  label: string;
  icon: ReactNode;
  shortcut?: string;
  onRun: () => void;
  className?: string;
}) {
  const button = (
    <IconButton
      label={label}
      icon={icon}
      size="sm"
      shortcut={shortcut ? keysLabel(shortcut) : undefined}
      onMouseDown={keepFocus}
      onClick={onRun}
    />
  );
  // Visibility on the wrapper: IconButton sets its own display.
  return className ? <span className={className}>{button}</span> : button;
}

const Divider = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('mx-1 h-4 w-px shrink-0 bg-line-strong', className)} />
);

export const EditorToolbar = memo(function EditorToolbar({
  view,
  inTable,
  onPickFile,
  onGridEditor,
  end,
}: ToolbarProps) {
  const [tableOpen, setTableOpen] = useState(false);
  const run = (command: (v: EditorView) => boolean | void) => () => {
    if (view) command(view);
  };
  const formatAll = (v: EditorView) => {
    const text = v.state.doc.toString();
    const next = formatAllTables(text);
    if (next !== text) v.dispatch({ changes: textChange(text, next), userEvent: 'input.format' });
    v.focus();
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="@container flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Heading" icon={<Heading />} size="sm" onMouseDown={keepFocus} />
          </MenuTrigger>
          <MenuContent align="start">
            {[1, 2, 3, 4].map((level) => (
              <MenuItem
                key={level}
                shortcut={keysLabel(`Mod ${level}`)}
                onSelect={run(setHeading(level))}
              >
                Heading {level}
              </MenuItem>
            ))}
            <MenuItem onSelect={run(setHeading(0))}>Plain text</MenuItem>
          </MenuContent>
        </Menu>
        <Tool label="Bold" icon={<Bold />} shortcut="Mod B" onRun={run(toggleWrap('**'))} />
        <Tool label="Italic" icon={<Italic />} shortcut="Mod I" onRun={run(toggleWrap('*'))} />
        <Tool
          label="Strikethrough"
          icon={<Strikethrough />}
          shortcut="Mod Shift X"
          onRun={run(toggleWrap('~~'))}
          className="hidden @min-[30rem]:contents"
        />
        <Tool
          label="Inline code"
          icon={<Code />}
          shortcut="Mod E"
          onRun={run(toggleWrap('`'))}
          className="hidden @min-[30rem]:contents"
        />
        <Tool label="Link" icon={<Link />} shortcut="Mod K" onRun={run(insertLink)} />
        <Divider className="hidden @min-[24rem]:block" />
        <Tool
          label="Bullet list"
          icon={<List />}
          shortcut="Mod Shift 8"
          onRun={run(toggleList('bullet'))}
          className="hidden @min-[24rem]:contents"
        />
        <Tool
          label="Numbered list"
          icon={<ListOrdered />}
          shortcut="Mod Shift 7"
          onRun={run(toggleList('ordered'))}
          className="hidden @min-[24rem]:contents"
        />
        <Tool
          label="Task list"
          icon={<ListChecks />}
          shortcut="Mod Shift 9"
          onRun={run(toggleList('task'))}
        />
        <Tool
          label="Quote"
          icon={<Quote />}
          onRun={run(toggleQuote)}
          className="hidden @min-[36rem]:contents"
        />
        <Divider className="hidden @min-[20rem]:block" />
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
              onPick={(columns, rows) => {
                setTableOpen(false);
                if (view) insertTable(view, columns, rows);
              }}
            />
          </PopoverContent>
        </Popover>
        {inTable && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton
                label="Table commands"
                icon={<Grid3x3 />}
                size="sm"
                onMouseDown={keepFocus}
                className="text-accent"
              />
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem
                icon={<WandSparkles />}
                shortcut={keysLabel('Mod Shift F')}
                onSelect={run(tableCommands.format)}
              >
                Format table
              </MenuItem>
              <MenuItem icon={<Grid3x3 />} onSelect={onGridEditor}>
                Edit as a grid…
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Rows3 />} onSelect={run(tableCommands.insertRowAbove)}>
                Row above
              </MenuItem>
              <MenuItem icon={<Rows3 />} onSelect={run(tableCommands.insertRowBelow)}>
                Row below
              </MenuItem>
              <MenuItem icon={<Columns3 />} onSelect={run(tableCommands.insertColumnLeft)}>
                Column on the left
              </MenuItem>
              <MenuItem icon={<Columns3 />} onSelect={run(tableCommands.insertColumnRight)}>
                Column on the right
              </MenuItem>
              <MenuItem icon={<ArrowLeftToLine />} onSelect={run(tableCommands.moveColumnLeft)}>
                Move column left
              </MenuItem>
              <MenuItem icon={<ArrowRightToLine />} onSelect={run(tableCommands.moveColumnRight)}>
                Move column right
              </MenuItem>
              <MenuSub>
                <MenuSubTrigger icon={<AlignLeft />}>Align column</MenuSubTrigger>
                <MenuSubContent>
                  <MenuItem
                    icon={<AlignLeft />}
                    onSelect={run((v) => tableCommands.align(v, 'left'))}
                  >
                    Left
                  </MenuItem>
                  <MenuItem
                    icon={<AlignCenter />}
                    onSelect={run((v) => tableCommands.align(v, 'center'))}
                  >
                    Centre
                  </MenuItem>
                  <MenuItem
                    icon={<AlignRight />}
                    onSelect={run((v) => tableCommands.align(v, 'right'))}
                  >
                    Right
                  </MenuItem>
                  <MenuItem onSelect={run((v) => tableCommands.align(v, 'none'))}>Default</MenuItem>
                </MenuSubContent>
              </MenuSub>
              <MenuItem icon={<ArrowDownAZ />} onSelect={run((v) => tableCommands.sort(v))}>
                Sort by this column
              </MenuItem>
              <MenuItem icon={<ArrowUpZA />} onSelect={run((v) => tableCommands.sort(v, true))}>
                Sort, descending
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger onSelect={run(tableCommands.deleteRow)}>
                Delete row
              </MenuItem>
              <MenuItem icon={<Trash2 />} danger onSelect={run(tableCommands.deleteColumn)}>
                Delete column
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
        <Tool
          label="Code block"
          icon={<SquareCode />}
          onRun={run(insertCodeBlock())}
          className="hidden @min-[36rem]:contents"
        />
        <Tool
          label="Image"
          icon={<ImagePlus />}
          onRun={() => onPickFile(true)}
          className="hidden @min-[20rem]:contents"
        />
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="More" icon={<Ellipsis />} size="sm" onMouseDown={keepFocus} />
          </MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>Formatting</MenuLabel>
            <MenuItem icon={<Strikethrough />} onSelect={run(toggleWrap('~~'))}>
              Strikethrough
            </MenuItem>
            <MenuItem icon={<Code />} onSelect={run(toggleWrap('`'))}>
              Inline code
            </MenuItem>
            <MenuItem icon={<List />} onSelect={run(toggleList('bullet'))}>
              Bullet list
            </MenuItem>
            <MenuItem icon={<ListOrdered />} onSelect={run(toggleList('ordered'))}>
              Numbered list
            </MenuItem>
            <MenuItem icon={<Quote />} onSelect={run(toggleQuote)}>
              Quote
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Insert</MenuLabel>
            <MenuItem icon={<SquareCode />} onSelect={run(insertCodeBlock())}>
              Code block
            </MenuItem>
            <MenuItem icon={<Network />} onSelect={run(insertMermaid)}>
              Diagram (Mermaid)
            </MenuItem>
            <MenuItem icon={<Sigma />} onSelect={run(insertMath)}>
              Formula
            </MenuItem>
            <MenuItem icon={<TriangleAlert />} onSelect={run(insertCallout('NOTE'))}>
              Note box
            </MenuItem>
            <MenuItem icon={<Minus />} onSelect={run(insertRule)}>
              Divider
            </MenuItem>
            <MenuItem icon={<Calendar />} onSelect={run(insertDate)}>
              Today’s date
            </MenuItem>
            <MenuItem icon={<ImagePlus />} onSelect={() => onPickFile(true)}>
              Image…
            </MenuItem>
            <MenuItem icon={<FileUp />} onSelect={() => onPickFile(false)}>
              File…
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<WandSparkles />} onSelect={run(formatAll)}>
              Format all tables
            </MenuItem>
            <MenuItem
              icon={<Search />}
              shortcut={keysLabel('Mod F')}
              onSelect={run((v) => {
                openSearchPanel(v);
              })}
            >
              Find and replace
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {end}
    </div>
  );
});
