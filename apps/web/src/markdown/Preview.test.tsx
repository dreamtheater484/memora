import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Preview } from './Preview';

vi.mock('../diagrams/DrawnDiagram', () => ({
  DrawnDiagram: ({ code }: { code: string }) => <div data-testid="drawn">{code}</div>,
}));

describe('diagrams in the preview', () => {
  it('draws Mermaid in any case, in lists and callouts too, each with its Edit button', async () => {
    const edit = vi.fn();
    render(
      <Preview
        text={[
          '```Mermaid',
          'pie title One',
          '```',
          '',
          '- Step',
          '  ```MERMAID',
          '  pie title Two',
          '  ```',
          '',
          '> [!NOTE]',
          '> ```mermaid',
          '> pie title Three',
          '> ```',
        ].join('\n')}
        onEditDiagram={edit}
      />,
    );
    // The pipeline loads on first use, which takes a while on a busy machine.
    await waitFor(() => expect(screen.getAllByTestId('drawn')).toHaveLength(3), {
      timeout: 10_000,
    });
    expect(screen.getAllByTestId('drawn').map((d) => d.textContent?.trim())).toEqual([
      'pie title One',
      'pie title Two',
      'pie title Three',
    ]);
    const buttons = screen.getAllByRole('button', { name: 'Edit diagram' });
    buttons.forEach((button) => fireEvent.click(button));
    expect(edit.mock.calls.map(([line]) => line as number)).toEqual([1, 6, 11]);
  });
});
