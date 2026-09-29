import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, type PaletteItem } from './CommandPalette';
import { PageTree, type TreeNode } from './PageTree';
import { SaveIndicator } from './SaveIndicator';
import { SectionTabs } from './SectionTabs';
import { SplitPane } from './SplitPane';
import { TooltipProvider } from './Tooltip';

describe('SaveIndicator', () => {
  it('shows each state with a label', () => {
    const { rerender } = render(<SaveIndicator state="saved" compact={false} />);
    expect(screen.getByText('Saved')).toBeTruthy();
    rerender(<SaveIndicator state="saving" compact={false} />);
    expect(screen.getByText('Saving…')).toBeTruthy();
    rerender(<SaveIndicator state="dirty" compact={false} />);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    rerender(<SaveIndicator state="offline" pending={3} />);
    expect(screen.getByText('Offline · 3 pending')).toBeTruthy();
    rerender(<SaveIndicator state="conflict" />);
    expect(screen.getByText('Conflict')).toBeTruthy();
  });

  it('announces only offline and conflict, not every autosave', () => {
    const { rerender } = render(<SaveIndicator state="saving" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    rerender(<SaveIndicator state="saved" />);
    expect(status.textContent).toBe('');
    rerender(<SaveIndicator state="offline" pending={2} />);
    expect(status.textContent).toMatch(/offline.*2 changes/i);
    rerender(<SaveIndicator state="conflict" />);
    expect(status.textContent).toMatch(/changed elsewhere/i);
  });

  it('is a button when it has an action', async () => {
    const onClick = vi.fn();
    render(<SaveIndicator state="conflict" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: /conflict/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('SplitPane', () => {
  function setup(props: Partial<Parameters<typeof SplitPane>[0]> = {}) {
    const onSizeChange = vi.fn();
    render(
      <SplitPane
        first="A"
        second="B"
        defaultSize={50}
        min={20}
        max={80}
        onSizeChange={onSizeChange}
        {...props}
      />,
    );
    return { separator: screen.getByRole('separator'), onSizeChange };
  }

  it('describes its position for assistive technology', () => {
    const { separator } = setup();
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
    expect(separator.getAttribute('aria-valuemin')).toBe('20');
    expect(separator.getAttribute('aria-valuemax')).toBe('80');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('resizes with the arrow keys, Shift for big steps', () => {
    const { separator } = setup();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('52');
    fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
    expect(separator.getAttribute('aria-valuenow')).toBe('32');
  });

  it('stops at the limits and jumps there with Home and End', () => {
    const { separator } = setup();
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator.getAttribute('aria-valuenow')).toBe('80');
    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true });
    expect(separator.getAttribute('aria-valuenow')).toBe('80');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('20');
  });

  it('collapses with Enter and restores with Enter again', () => {
    const { separator, onSizeChange } = setup();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(separator.getAttribute('aria-valuenow')).toBe('20');
    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(separator.getAttribute('aria-valuenow')).toBe('52');
    expect(onSizeChange).toHaveBeenLastCalledWith(52);
  });
});

interface Node extends TreeNode {
  children?: Node[];
}

const TREE: Node[] = [
  {
    id: 'work',
    label: 'Work',
    children: [
      { id: 'roadmap', label: 'Roadmap' },
      { id: 'research', label: 'Research', children: [{ id: 'interviews', label: 'Interviews' }] },
    ],
  },
  { id: 'personal', label: 'Personal', children: [{ id: 'travel', label: 'Travel' }] },
];

function Tree() {
  const [selected, setSelected] = useState<string | null>('roadmap');
  return (
    <PageTree
      label="Notebooks"
      nodes={TREE}
      selectedId={selected}
      onSelect={(n) => setSelected(n.id)}
      defaultExpanded={['work']}
    />
  );
}

describe('PageTree', () => {
  const item = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });

  it('exposes levels, expansion and selection', () => {
    render(<Tree />);
    expect(screen.getByRole('tree', { name: 'Notebooks' })).toBeTruthy();
    expect(item('Work').getAttribute('aria-expanded')).toBe('true');
    expect(item('Personal').getAttribute('aria-expanded')).toBe('false');
    expect(item('Roadmap').getAttribute('aria-level')).toBe('2');
    expect(item('Roadmap').getAttribute('aria-selected')).toBe('true');
    // Only the selected row is in the tab order.
    expect(item('Roadmap').tabIndex).toBe(0);
    expect(item('Work').tabIndex).toBe(-1);
  });

  it('follows the WAI-ARIA tree keys', async () => {
    const user = userEvent.setup();
    render(<Tree />);
    item('Roadmap').focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item('Research'));

    await user.keyboard('{ArrowRight}'); // expands
    expect(item('Research').getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowRight}'); // moves into the first child
    expect(document.activeElement).toBe(item('Interviews'));

    await user.keyboard('{ArrowLeft}'); // leaf: back to the parent
    expect(document.activeElement).toBe(item('Research'));
    await user.keyboard('{ArrowLeft}'); // collapses
    expect(item('Research').getAttribute('aria-expanded')).toBe('false');

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(item('Personal'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(item('Work'));

    await user.keyboard('p'); // type-ahead
    expect(document.activeElement).toBe(item('Personal'));

    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(item('Travel').getAttribute('aria-selected')).toBe('true');
    expect(item('Roadmap').getAttribute('aria-selected')).toBe('false');
  });
});

describe('SectionTabs', () => {
  function Tabs() {
    const [value, setValue] = useState('a');
    return (
      <TooltipProvider>
        <SectionTabs
          value={value}
          onValueChange={setValue}
          sections={[
            { id: 'a', name: 'Roadmap', color: 'blue' },
            { id: 'b', name: 'Research', color: 'teal' },
            { id: 'c', name: 'Meetings', color: 'amber' },
          ]}
        />
      </TooltipProvider>
    );
  }

  it('moves and selects with the arrow keys, wrapping around', async () => {
    const user = userEvent.setup();
    render(<Tabs />);
    const tab = (name: string) => screen.getByRole('tab', { name });
    expect(tab('Roadmap').getAttribute('aria-selected')).toBe('true');
    expect(tab('Research').tabIndex).toBe(-1);

    tab('Roadmap').focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Research'));
    expect(tab('Research').getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tab('Meetings').getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Home}');
    expect(tab('Roadmap').getAttribute('aria-selected')).toBe('true');
  });
});

describe('CommandPalette', () => {
  function Palette({ onRun }: { onRun: (id: string) => void }) {
    const [open, setOpen] = useState(true);
    const items: PaletteItem[] = [
      { id: 'q4', title: 'Q4 roadmap', group: 'Pages', onSelect: () => onRun('q4') },
      { id: 'comp', title: 'Competitor notes', group: 'Pages', onSelect: () => onRun('comp') },
      {
        id: 'dark',
        title: 'Switch to dark theme',
        group: 'Commands',
        onSelect: () => onRun('dark'),
      },
    ];
    return <CommandPalette open={open} onOpenChange={setOpen} items={items} />;
  }

  it('filters as you type and runs the active result with Enter', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<Palette onRun={onRun} />);
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);

    await user.keyboard('dark');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Switch to dark theme']);

    await user.keyboard('{Enter}');
    expect(onRun).toHaveBeenCalledWith('dark');
    expect(screen.queryByRole('combobox')).toBeNull(); // closed
  });

  it('moves the active option with the arrow keys and wraps', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<Palette onRun={onRun} />);
    const input = screen.getByRole('combobox');
    const active = () => document.getElementById(input.getAttribute('aria-activedescendant')!);

    expect(active()?.textContent).toBe('Q4 roadmap');
    await user.keyboard('{ArrowDown}');
    expect(active()?.textContent).toBe('Competitor notes');
    expect(active()?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}{ArrowDown}'); // past the end: back to the top
    expect(active()?.textContent).toBe('Q4 roadmap');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onRun).toHaveBeenCalledWith('dark');
  });

  it('groups results under labelled headings', () => {
    render(<Palette onRun={() => {}} />);
    expect(screen.getByRole('group', { name: 'Pages' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Commands' })).toBeTruthy();
  });
});
