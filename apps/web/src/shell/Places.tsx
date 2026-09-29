import type { Place } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Clock, FileText, Star, StarOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { IconButton } from '../components/ui';
import { cn } from '../lib/cn';
import type { NotesIndex } from '../notes/model';
import { toggleFavorite, useFavorites, useRecent } from '../notes/places';
import { useUiState } from '../notes/queries';
import { hueStyle } from '../theme/sections';
import { useCurrent, useGo } from './location';
import { NotebookTile } from './parts';

/* Favourites and recent pages in the navigation (§9.9). */

function describe(index: NotesIndex, place: Place): { label: string; icon: ReactNode } | null {
  if (place.type === 'page') {
    const page = index.page.get(place.id);
    if (!page) return null;
    const section = index.section.get(page.sectionId);
    return {
      label: page.title || 'Untitled page',
      icon: (
        <span className="hue relative" style={section ? hueStyle(section.color) : undefined}>
          <FileText className="size-4 text-sec-ink" />
        </span>
      ),
    };
  }
  if (place.type === 'section') {
    const section = index.section.get(place.id);
    if (!section) return null;
    return {
      label: section.name,
      icon: (
        <span className="hue grid size-4 place-items-center" style={hueStyle(section.color)}>
          <span className="size-2.5 rounded-full bg-sec" />
        </span>
      ),
    };
  }
  const notebook = index.notebook.get(place.id);
  if (!notebook) return null;
  return {
    label: notebook.name,
    icon: (
      <span className="hue" style={hueStyle(notebook.color)}>
        <NotebookTile icon={notebook.icon} className="size-4 rounded-[5px] [&>svg]:size-3" />
      </span>
    ),
  };
}

function PlaceRow({ place, trailing }: { place: Place; trailing?: ReactNode }) {
  const { index, page, section, notebook, level } = useCurrent();
  const go = useGo();
  const shown = describe(index, place);
  if (!shown) return null;
  const current =
    (place.type === 'page' && page?.id === place.id && level === 'page') ||
    (place.type === 'section' && section?.id === place.id && level === 'section') ||
    (place.type === 'notebook' && notebook?.id === place.id && level === 'notebook');
  const open = () =>
    place.type === 'page'
      ? go.page(place.id)
      : place.type === 'section'
        ? go.section(place.id)
        : go.notebook(place.id);
  return (
    <li className="group/place relative">
      <button
        type="button"
        onClick={open}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'flex h-[1.75rem] w-full items-center gap-2 rounded-sm pr-8 pl-6 text-left text-sm whitespace-nowrap',
          current ? 'bg-active font-semibold text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
        )}
      >
        {shown.icon}
        <span className="min-w-0 truncate">{shown.label}</span>
      </button>
      {trailing && (
        <span className="absolute top-0.5 right-1 opacity-0 group-focus-within/place:opacity-100 group-hover/place:opacity-100">
          {trailing}
        </span>
      )}
    </li>
  );
}

function Toggle({
  open,
  onToggle,
  icon,
  children,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  children: ReactNode;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-[1.875rem] w-full items-center gap-2 rounded-sm px-2 text-left text-base whitespace-nowrap text-fg-2 hover:bg-hover hover:text-fg [&>svg]:size-4 [&>svg]:shrink-0"
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      <span className="ml-auto flex items-center gap-1 text-xs text-fg-3 tabular-nums">
        {count || ''}
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </span>
    </button>
  );
}

export function RecentPlaces() {
  const [open, setOpen] = useState(false);
  const { index } = useCurrent();
  const recent = useRecent().filter((r) => describe(index, r));
  return (
    <div>
      <Toggle
        open={open}
        onToggle={() => setOpen(!open)}
        icon={<Clock />}
        count={Math.min(recent.length, 10)}
      >
        Recent
      </Toggle>
      {open && (
        <ul aria-label="Recent" className="flex flex-col gap-px">
          {recent.length ? (
            recent.slice(0, 10).map((r) => <PlaceRow key={`${r.type}:${r.id}`} place={r} />)
          ) : (
            <li className="py-1 pl-8 text-xs text-fg-3">Pages you open appear here.</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function FavoritePlaces() {
  const { index } = useCurrent();
  const queryClient = useQueryClient();
  const ui = useUiState();
  const favorites = useFavorites().filter((f) => describe(index, f));
  // Open while there are favourites to show, unless closed by hand.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? favorites.length > 0;
  const setOpen = (value: boolean) => setToggled(value);
  return (
    <div>
      <Toggle open={open} onToggle={() => setOpen(!open)} icon={<Star />} count={favorites.length}>
        Favourites
      </Toggle>
      {open && (
        <ul aria-label="Favourites" className="flex flex-col gap-px">
          {favorites.length ? (
            favorites.map((f) => (
              <PlaceRow
                key={`${f.type}:${f.id}`}
                place={f}
                trailing={
                  <IconButton
                    label="Remove from favourites"
                    icon={<StarOff />}
                    size="xs"
                    onClick={() => toggleFavorite(queryClient, ui, f)}
                  />
                }
              />
            ))
          ) : (
            <li className="py-1 pl-8 text-xs text-fg-3">
              Star a page, section or notebook to keep it here.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
