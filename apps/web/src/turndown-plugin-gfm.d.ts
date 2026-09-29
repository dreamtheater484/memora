/** GFM rules (tables, strikethrough, task lists) for turndown; the package ships no types. */
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
}
