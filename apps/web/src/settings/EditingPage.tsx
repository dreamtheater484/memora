import {
  RICH_FONTS,
  RICH_FONT_SIZES,
  type EditorSettings,
  type PageType,
  type PageView,
  type RichSpacing,
  type ViewMode,
} from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { SegmentedControl, Select, Switch, toast } from '../components/ui';
import { errorMessage } from '../lib/api';
import { saveEditorSettings, useEditorSettings } from '../notes/queries';
import { SettingsSection } from './SettingsLayout';

/*
 * Editing preferences (§9.16): how the Markdown and rich text editors look and behave, on
 * every device.
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

const PAGE_TYPES: { value: PageType; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'rich', label: 'Rich text' },
];

const PAGE_VIEWS: { value: PageView; label: string }[] = [
  { value: 'off', label: 'Fit the window' },
  { value: 'a4', label: 'A4 page' },
  { value: 'letter', label: 'Letter page' },
];

const SPACINGS: { value: RichSpacing; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
];

/** Memora's own font is stored as '' (a select item can't be empty). */
const OWN_FONT = 'memora';
const FONTS = [
  { value: OWN_FONT, label: 'Memora (Figtree)' },
  ...RICH_FONTS.map((f) => ({ value: f.value, label: f.label })),
];

const SIZES = RICH_FONT_SIZES.filter((size) => size >= 9 && size <= 20).map((size) => ({
  value: String(size),
  label: `${size} pt`,
}));

const LINE_LENGTHS = [
  { value: '70', label: 'Narrow (70 characters)' },
  { value: '80', label: 'Medium (80 characters)' },
  { value: '90', label: 'Wide (90 characters)' },
  { value: '100', label: 'Widest (100 characters)' },
];

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
        title="New pages"
        description="Markdown pages are plain text with formatting marks; rich text pages work like a word processor. A page can be converted later from its menu."
      >
        <Row
          label="New pages are"
          control={() => (
            <SegmentedControl
              label="New pages are"
              value={settings.pageType}
              onValueChange={(pageType) => save({ pageType })}
              segments={PAGE_TYPES}
            />
          )}
        />
      </SettingsSection>
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
        title="Line length"
        description="Markdown text stops at a readable width, so lines don't run across a wide screen. A page can be shown at full width from its menu. (Rich text fills the pane: drag its right edge to narrow it.)"
      >
        <Row
          label="Longest line"
          control={(id) => (
            <Select
              id={id}
              aria-label="Longest line"
              value={String(settings.lineLength)}
              onValueChange={(value) => save({ lineLength: Number(value) })}
              options={LINE_LENGTHS}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection title="Rich text pages" description="How rich text pages look.">
        <Row
          label="Spacing"
          description="Compact keeps lines and paragraphs close together, as in a notebook."
          control={() => (
            <SegmentedControl
              label="Spacing"
              value={settings.richSpacing}
              onValueChange={(richSpacing) => save({ richSpacing })}
              segments={SPACINGS}
            />
          )}
        />
        <Row
          label="Font"
          description="For text without a font of its own."
          control={(id) => (
            <Select
              id={id}
              aria-label="Font"
              value={
                RICH_FONTS.some((f) => f.value === settings.richFont) ? settings.richFont : OWN_FONT
              }
              onValueChange={(value) => save({ richFont: value === OWN_FONT ? '' : value })}
              options={FONTS}
            />
          )}
        />
        <Row
          label="Font size"
          description="For text without a size of its own."
          control={(id) => (
            <Select
              id={id}
              aria-label="Font size"
              value={String(settings.richFontSize)}
              onValueChange={(value) => save({ richFontSize: Number(value) })}
              options={SIZES}
            />
          )}
        />
        <Row
          label="Show pages as"
          description="A sheet of paper shows how a page will print or export."
          control={(id) => (
            <Select
              id={id}
              aria-label="Show pages as"
              value={settings.pageView}
              onValueChange={(pageView) => save({ pageView: pageView as PageView })}
              options={PAGE_VIEWS}
            />
          )}
        />
      </SettingsSection>
      <SettingsSection
        title="Images"
        description="Pasted and dropped images, in both kinds of page."
      >
        {toggle(
          'downscaleImages',
          'Make large images smaller',
          'Photos are stored as WebP; screenshots stay lossless PNG.',
        )}
        <Row
          label="Longest side"
          control={(id) => (
            <Select
              id={id}
              aria-label="Longest side"
              value={String(settings.maxImageEdge)}
              onValueChange={(value) => save({ maxImageEdge: Number(value) })}
              options={[1280, 1920, 2560, 3840].map((n) => ({
                value: String(n),
                label: `${n} pixels`,
              }))}
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
