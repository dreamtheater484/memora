import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/*
 * The Notepad++-style source view (§9.3): a monospace grid where tables line up, headings
 * sized by level, and colours for every part of Markdown and for code inside code blocks.
 * Colours are written with light-dark(), so the theme follows the app without reconfiguring.
 */

const c = (light: string, dark: string) => `light-dark(${light}, ${dark})`;

const colours = {
  heading: c('#1f4fb8', '#8fb4ff'),
  mark: c('#8a93a8', '#6f7891'),
  link: 'var(--accent)',
  url: c('#5b6b8c', '#94a3c2'),
  code: c('#a3326b', '#f08bc0'),
  quote: c('#5d6b50', '#b6c79f'),
  list: c('#b3591a', '#f0a36a'),
  html: c('#8a3fb0', '#d5a0f5'),
  meta: c('#7a7f91', '#8e94a8'),
  keyword: c('#0033b3', '#7ab4ff'),
  string: c('#067d17', '#8bd18a'),
  number: c('#1750eb', '#79c0ff'),
  comment: c('#8c8c8c', '#7d8599'),
  type: c('#00627a', '#6fd3e6'),
  func: c('#00627a', '#dcbdfb'),
  property: c('#871094', '#f0a3ff'),
  operator: c('#3b3b3b', '#c9d1d9'),
  invalid: 'var(--danger)',
};

export const markdownHighlight = HighlightStyle.define([
  // Markdown.
  { tag: t.heading1, color: colours.heading, fontWeight: '700', fontSize: '1.3em' },
  { tag: t.heading2, color: colours.heading, fontWeight: '700', fontSize: '1.18em' },
  { tag: t.heading3, color: colours.heading, fontWeight: '700', fontSize: '1.08em' },
  { tag: [t.heading4, t.heading5, t.heading6], color: colours.heading, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: colours.link, textDecoration: 'underline' },
  { tag: t.url, color: colours.url },
  { tag: t.monospace, color: colours.code },
  { tag: t.quote, color: colours.quote, fontStyle: 'italic' },
  { tag: t.list, color: colours.list },
  { tag: [t.processingInstruction, t.contentSeparator], color: colours.mark },
  { tag: t.labelName, color: colours.link },
  // HTML inside Markdown, and front matter.
  { tag: [t.angleBracket, t.tagName], color: colours.html },
  { tag: t.attributeName, color: colours.property },
  { tag: t.attributeValue, color: colours.string },
  { tag: t.meta, color: colours.meta },
  // Code inside fenced blocks.
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword],
    color: colours.keyword,
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: colours.string },
  { tag: [t.number, t.bool, t.null, t.atom], color: colours.number },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: colours.comment,
    fontStyle: 'italic',
  },
  { tag: [t.typeName, t.className, t.namespace], color: colours.type },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: colours.func },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: colours.property },
  { tag: [t.operator, t.punctuation], color: colours.operator },
  { tag: t.invalid, color: colours.invalid },
]);

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--fg)',
    backgroundColor: 'transparent',
    fontSize: '0.9375rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
    overflow: 'auto',
    // Room at the end, so the last line can be typed on in the middle of the screen.
    paddingBottom: '30vh',
  },
  // Every character as typed: no ligatures turning `-->` or `!=` into symbols. The page's
  // readable width (`--measure`, MarkdownPage) is a maximum: with wrapped lines the text is
  // never wider than its pane, whatever it holds (a wide drawing scrolls on its own).
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '0.25rem 0',
    fontVariantLigatures: 'none',
    minWidth: '0',
  },
  '.cm-line': { padding: '0 0.25rem 0 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'color-mix(in oklab, var(--accent) 24%, transparent)' },
  // The current line only while typing: an idle editor reads like a page.
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine': { backgroundColor: 'var(--cur-line)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--fg-3)',
    border: 'none',
    fontSize: '0.8em',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.75rem 0 0.25rem', minWidth: '2.5rem' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 0.2rem', cursor: 'pointer' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--hover)',
    border: '1px solid var(--line)',
    color: 'var(--fg-2)',
    padding: '0 0.4em',
    borderRadius: '0.3em',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 20%, transparent)',
    outline: '1px solid color-mix(in oklab, var(--accent) 45%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--mark)',
    outline: '1px solid color-mix(in oklab, var(--warn) 50%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 35%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--accent) 12%, transparent)' },
  '.cm-highlightSpace': {
    backgroundImage: 'radial-gradient(circle at 50% 55%, var(--fg-3) 12%, transparent 16%)',
    opacity: '0.7',
  },
  '.cm-highlightTab': { opacity: '0.6' },
  '.cm-placeholder': { color: 'var(--fg-3)' },
  // The find and replace bar.
  '.cm-panels': {
    backgroundColor: 'var(--raised)',
    color: 'var(--fg)',
    borderColor: 'var(--line)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-panel.cm-search': {
    padding: '0.5rem 0.75rem',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    fontSize: '0.85rem',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line-strong)',
    borderRadius: '0.4rem',
    padding: '0.2rem 0.45rem',
    color: 'var(--fg)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line-strong)',
    borderRadius: '0.4rem',
    padding: '0.2rem 0.6rem',
    color: 'var(--fg)',
  },
  '.cm-panel.cm-search [name=close]': { color: 'var(--fg-2)', fontSize: '1.1rem' },
  // Autocomplete (slash commands, [[links).
  '.cm-tooltip': {
    backgroundColor: 'var(--raised)',
    border: '1px solid var(--line)',
    borderRadius: '0.6rem',
    boxShadow: 'var(--shadow-pop)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-sans)',
    maxHeight: '16rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '0.3rem 0.7rem', lineHeight: '1.5' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--fg)',
  },
  '.cm-completionDetail': { marginLeft: '0.75rem', color: 'var(--fg-3)', fontStyle: 'normal' },
  '.cm-completionIcon': { display: 'none' },
  // Image thumbnails under their lines.
  '.cm-image-thumb': { display: 'block', padding: '0.25rem 0 0.5rem' },
  // A diagram drawn in place of its code, with its two buttons (diagrams.ts), indented like
  // its code in a list item or a quote (`ch` of the editor's font, so it is set out here). It
  // takes the text's width and never sets it: a drawing wider than the pane scrolls inside.
  '.cm-diagram': {
    position: 'relative',
    margin: '0.25rem 0',
    marginLeft: 'calc(var(--cm-diagram-indent, 0) * 1ch)',
    padding: '0.75rem',
    border: '1px solid var(--line)',
    borderRadius: '0.5rem',
    background: 'var(--surface)',
    cursor: 'default',
    contain: 'inline-size',
  },
  '.cm-diagram > *': { fontFamily: 'var(--font-sans)' },
  '.cm-diagram-tools': {
    position: 'absolute',
    top: '0.4rem',
    right: '0.4rem',
    display: 'flex',
    gap: '0.25rem',
    opacity: '0',
    transition: 'opacity 120ms ease',
  },
  '.cm-diagram:hover .cm-diagram-tools, .cm-diagram-tools:focus-within': { opacity: '1' },
  '.cm-diagram-tools button': {
    padding: '0.2rem 0.6rem',
    borderRadius: '999px',
    border: '1px solid var(--line-strong)',
    background: 'var(--raised)',
    color: 'var(--fg)',
    fontSize: '0.78rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
  '@media (hover: none)': { '.cm-diagram-tools': { opacity: '1' } },
  '.cm-image-thumb img': {
    maxHeight: '8rem',
    maxWidth: 'min(100%, 20rem)',
    borderRadius: '0.4rem',
    border: '1px solid var(--line)',
  },
});
