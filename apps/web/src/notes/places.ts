import { MAX_FAVORITES, MAX_RECENT, type Place, type UiState } from '@memora/shared';
import type { QueryClient } from '@tanstack/react-query';
import { saveUiState, useUiState } from './queries';

/*
 * Favourites and recent items (§9.9) live in the user's UI state, so they follow the user to
 * every device and are there offline too.
 */

const same = (a: Place, b: Place) => a.type === b.type && a.id === b.id;

export function useFavorites(): Place[] {
  return useUiState().favorites ?? [];
}

export function useRecent(): (Place & { at: number })[] {
  return useUiState().recent ?? [];
}

export function isFavorite(favorites: readonly Place[], place: Place): boolean {
  return favorites.some((f) => same(f, place));
}

/** Stars or unstars a page, section or notebook. */
export function toggleFavorite(queryClient: QueryClient, ui: UiState, place: Place): boolean {
  const list = ui.favorites ?? [];
  const on = !isFavorite(list, place);
  const favorites = on
    ? [...list, { type: place.type, id: place.id }].slice(-MAX_FAVORITES)
    : list.filter((f) => !same(f, place));
  saveUiState(queryClient, { favorites }, 0);
  return on;
}

/** Remembers that something was opened, newest first. */
export function rememberOpened(queryClient: QueryClient, ui: UiState, place: Place): void {
  const list = ui.recent ?? [];
  if (list[0] && same(list[0], place)) return;
  const recent = [
    { type: place.type, id: place.id, at: Date.now() },
    ...list.filter((r) => !same(r, place)),
  ].slice(0, MAX_RECENT);
  saveUiState(queryClient, { recent });
}
