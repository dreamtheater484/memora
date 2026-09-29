import {
  columnCount,
  deleteColumn,
  deleteRow,
  escapeCell,
  insertColumn,
  insertRow,
  type Align,
  type Table,
} from '@memora/shared';
import { Columns3, Rows3, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button, DialogContent, IconButton } from '../components/ui';
import { cn } from '../lib/cn';

/*
 * The grid editor (§9.3): a table as a spreadsheet-like grid, handy on phones where the
 * source is narrow. It writes back perfectly aligned Markdown.
 */

const ALIGNS: { value: Align; label: string }[] = [
  { value: 'none', label: 'Default' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

/** Cells are edited as plain text; pipes are escaped when they go back into Markdown. */
const unescape = (text: string) => text.replace(/\\\|/g, '|');

export function GridEditor({
  table: initial,
  onSave,
  onCancel,
}: {
  table: Table;
  onSave: (table: Table) => void;
  onCancel: () => void;
}) {
  const count = columnCount(initial);
  const [table, setTable] = useState<Table>(() => ({
    header: Array.from({ length: count }, (_, i) => unescape(initial.header[i] ?? '')),
    align: Array.from({ length: count }, (_, i) => initial.align[i] ?? 'none'),
    rows: initial.rows.map((r) => Array.from({ length: count }, (_, i) => unescape(r[i] ?? ''))),
  }));
  const columns = columnCount(table);
  const setCell = (row: number, col: number, value: string) =>
    setTable((t) =>
      row < 0
        ? { ...t, header: t.header.map((c, i) => (i === col ? value : c)) }
        : {
            ...t,
            rows: t.rows.map((r, j) => (j === row ? r.map((c, i) => (i === col ? value : c)) : r)),
          },
    );
  const moveDown = (e: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = document.getElementById(`grid-${row + 1}-${col}`);
    if (next) next.focus();
    else {
      setTable((t) => insertRow(t, t.rows.length));
      requestAnimationFrame(() => document.getElementById(`grid-${row + 1}-${col}`)?.focus());
    }
  };
  const save = () =>
    onSave({
      header: table.header.map(escapeCell),
      align: table.align,
      rows: table.rows.map((r) => r.map(escapeCell)),
    });
  const cell = (row: number, col: number, value: string) => (
    <input
      id={`grid-${row}-${col}`}
      value={value}
      aria-label={row < 0 ? `Header, column ${col + 1}` : `Row ${row + 1}, column ${col + 1}`}
      onChange={(e) => setCell(row, col, e.target.value)}
      onKeyDown={(e) => moveDown(e, row, col)}
      className={cn(
        'h-8 w-full min-w-24 rounded-sm border border-line-strong bg-surface px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus',
        row < 0 && 'font-semibold',
        table.align[col] === 'right' && 'text-right',
        table.align[col] === 'center' && 'text-center',
      )}
    />
  );
  return (
    <DialogContent
      size="xl"
      title="Edit table"
      description="Type in the cells; Enter moves down and adds a row at the end."
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save table
          </Button>
        </>
      }
    >
      <div className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <td />
              {table.align.map((align, col) => (
                <td key={col} className="align-bottom">
                  <div className="flex items-center gap-1">
                    <select
                      aria-label={`Column ${col + 1} alignment`}
                      value={align}
                      onChange={(e) =>
                        setTable((t) => ({
                          ...t,
                          align: t.align.map((a, i) => (i === col ? (e.target.value as Align) : a)),
                        }))
                      }
                      className="h-7 min-w-0 flex-1 rounded-sm border border-line bg-surface px-1 text-xs text-fg-2"
                    >
                      {ALIGNS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {columns > 1 && (
                      <IconButton
                        label={`Delete column ${col + 1}`}
                        icon={<X />}
                        size="xs"
                        onClick={() => setTable((t) => deleteColumn(t, col))}
                      />
                    )}
                  </div>
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="pr-1 text-left text-2xs font-semibold text-fg-3 uppercase">
                Header
              </th>
              {table.header.map((value, col) => (
                <td key={col}>{cell(-1, col, value)}</td>
              ))}
            </tr>
            {table.rows.map((row, r) => (
              <tr key={r}>
                <th scope="row" className="pr-1">
                  <IconButton
                    label={`Delete row ${r + 1}`}
                    icon={<X />}
                    size="xs"
                    onClick={() => setTable((t) => deleteRow(t, r))}
                  />
                </th>
                {row.map((value, col) => (
                  <td key={col}>{cell(r, col, value)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setTable((t) => insertRow(t, t.rows.length))}>
          <Rows3 /> Add row
        </Button>
        <Button size="sm" onClick={() => setTable((t) => insertColumn(t, columnCount(t)))}>
          <Columns3 /> Add column
        </Button>
      </div>
    </DialogContent>
  );
}
