import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useState } from 'react';
import { DialogContent, Input } from '../components/ui';

/*
 * The computer's own fonts (§9.4), in browsers that can list them (Chromium, and the desktop
 * app): asked for once the list opens, which may first ask the user's permission. A font set
 * this way shows on computers that have it; others show their own font of the same kind.
 */

interface LocalFont {
  family: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFont[]>;
  }
}

/** A family name as a CSS value: only what font names are made of, quoted. */
const familyValue = (family: string) =>
  `"${family.replace(/[^\p{L}\p{N} .&'_-]/gu, '')}", sans-serif`;

type State = { families: string[] } | { error: string } | null;

export function LocalFontsDialog({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [state, setState] = useState<State>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const fonts = (await window.queryLocalFonts?.()) ?? [];
        const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) =>
          a.localeCompare(b),
        );
        if (live) setState({ families });
      } catch {
        if (live) setState({ error: 'Memora wasn’t allowed to see this computer’s fonts.' });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    if (!state || !('families' in state)) return [];
    const wanted = filter.trim().toLowerCase();
    return wanted ? state.families.filter((f) => f.toLowerCase().includes(wanted)) : state.families;
  }, [state, filter]);

  const pick = (family: string) => {
    editor.chain().focus().setFontFamily(familyValue(family)).run();
    onDone();
  };

  return (
    <DialogContent
      size="sm"
      title="This computer’s fonts"
      description="For the selected text. Computers without the font show a similar one."
    >
      <Input
        aria-label="Find a font"
        placeholder="Find a font"
        value={filter}
        autoFocus
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="mt-2 max-h-[50dvh] overflow-y-auto">
        {state === null && <p className="py-3 text-sm text-fg-2">Looking for fonts…</p>}
        {state && 'error' in state && <p className="py-3 text-sm text-fg-2">{state.error}</p>}
        {state && 'families' in state && !shown.length && (
          <p className="py-3 text-sm text-fg-2">No font is called that.</p>
        )}
        <ul aria-label="Fonts" className="flex flex-col gap-px">
          {shown.map((family) => (
            <li key={family}>
              <button
                type="button"
                onClick={() => pick(family)}
                className="w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-hover"
                style={{ fontFamily: familyValue(family) }}
              >
                {family}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </DialogContent>
  );
}
