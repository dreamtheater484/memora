import { create } from 'zustand';

/*
 * Card keys in notes (§9.11): `WEB-42` links to the card when a project has the key `WEB`.
 * The keys known are kept here for the Markdown preview and the rich editor; following one
 * goes through an event the shell turns into navigation.
 */

export const useCardKeys = create<{ keys: ReadonlySet<string> }>()(() => ({ keys: new Set() }));

/** Whether `WEB-42` names a card of a known project. */
export function knownCardKey(key: string): boolean {
  const project = key.slice(0, key.lastIndexOf('-'));
  return useCardKeys.getState().keys.has(project);
}

export const OPEN_CARD_EVENT = 'memora:open-card';

/** Opens the card with this key. */
export function openCardKey(key: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_CARD_EVENT, { detail: key }));
}
