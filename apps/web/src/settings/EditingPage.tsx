import type { EditorSettings, ViewMode } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { SegmentedControl, Select, Switch, toast } from '../components/ui';
import { errorMessage } from '../lib/api';
import { saveEditorSettings, useEditorSettings } from '../notes/queries';
import { SettingsSection } from './SettingsLayout';

/*
 * Editing preferences (§9.16): how the Markdown editor looks and behaves, on every device.
 */

function Row({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-xs text-fg-2">{description}</p>}
      </div>
      {control(id)}
    </div>
  );
}

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: 'source', label: 'Source' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Preview' },
];

export function EditingPage() {
  const settings = useEditorSettings();
  const queryClient = useQueryClient();
  const save = (patch: EditorSettings) => {
    saveEditorSettings(queryClient, patch).catch((error: unknown) =>
      toast({
        title: 'Couldn’t save the setting',
        description: errorMessage(error),
        tone: 'error',
      }),
    );
  };
  const toggle = (key: keyof EditorSettings, label: string, description?: string) => (
    <Row
      label={label}
      description={description}
      control={(id) => (
        <Switch
          id={id}
          checked={settings[key] as boolean}
          onCheckedChange={(value) => save({ [key]: value })}
        />
      )}
    />
  );
  return (
    <>
      <SettingsSection
        title="Markdown pages"
        description="How Markdown pages open and look while you write. These follow you to every device."
      >
        <Row
          label="Open pages in"
          description="Until a page is switched to a view of its own."
          control={() => (
            <SegmentedControl
              label="Open pages in"
              value={settings.viewMode}
              onValueChange={(viewMode) => save({ viewMode })}
              segments={VIEW_MODES}
            />
          )}
        />
        {toggle('lineNumbers', 'Line numbers')}
        {toggle('wordWrap', 'Wrap long lines', 'Otherwise long lines scroll sideways.')}
        {toggle('whitespace', 'Show spaces', 'Dots for spaces, arrows for tabs.')}
        {toggle('spellcheck', 'Check spelling', 'Uses your browser’s spellchecker.')}
        {toggle(
          'imageThumbnails',
          'Image previews in the source',
          'Small pictures under image lines.',
        )}
        <Row
          label="Tab size"
          control={(id) => (
            <Select
              id={id}
              aria-label="Tab size"
              value={String(settings.tabSize)}
              onValueChange={(value) => save({ tabSize: Number(value) })}
              options={[2, 4, 8].map((n) => ({ value: String(n), label: `${n} spaces` }))}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection
        title="Tables"
        description="Markdown tables are padded so their columns line up in the source."
      >
        {toggle(
          'formatTables',
          'Line tables up while typing',
          'When you type |, press Tab or Enter, or pause in a table.',
        )}
        {toggle(
          'formatTablesOnSave',
          'Line up every table when saving',
          'When you press Ctrl+S (⌘S on a Mac).',
        )}
      </SettingsSection>
    </>
  );
}
