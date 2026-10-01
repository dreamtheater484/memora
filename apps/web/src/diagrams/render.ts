import { DIAGRAM_COLOURS, DIAGRAM_SWATCHES, colourClass, diagramSummary } from '@memora/shared';
import DOMPurify from 'dompurify';
import figtreeUrl from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url';
import './render.css';
import { diagramHues, diagramShadow, mermaidConfig, type DiagramTheme } from './theme';

/*
 * Drawing diagrams (§9.3, §9.4): one Mermaid, loaded the first time a diagram is shown,
 * drawing one diagram at a time (it can't do two at once), with the last drawings kept.
 * The SVG is sanitised a second time after Mermaid's strict mode, and labelled for screen
 * readers. Exports get a light drawing with the font inside, so a canvas draws it as shown.
 */

export interface Drawing {
  svg: string;
  width: number;
  height: number;
}

type Mermaid = (typeof import('mermaid'))['default'];

let loading: Promise<Mermaid> | null = null;
const load = () =>
  (loading ??= import('mermaid').then(({ default: mermaid }) => {
    // Mind maps as tidy trees, in place of Mermaid's force layout (see mindmapLayout.ts).
    mermaid.registerLayoutLoaders([
      { name: 'cose-bilkent', loader: () => import('./mindmapLayout') },
    ]);
    return mermaid;
  }));

/** The one render at a time. */
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

const CACHE_SIZE = 40;
const cache = new Map<string, Promise<Drawing>>();

function remember(key: string, drawing: Promise<Drawing>) {
  cache.set(key, drawing);
  // A failed drawing isn't kept: the next try may succeed (Mermaid still loading, offline).
  drawing.catch(() => cache.get(key) === drawing && cache.delete(key));
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Mermaid's messages, shortened to their first line and without its parser's details. */
function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const first = text.split('\n')[0]!.replace(/^Error:\s*/, '');
  return first.length > 160 ? `${first.slice(0, 157)}…` : first || 'The diagram has a mistake';
}

export class DiagramError extends Error {}

function size(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox?.baseVal;
  const width = box?.width || Number.parseFloat(svg.getAttribute('width') ?? '') || 400;
  const height = box?.height || Number.parseFloat(svg.getAttribute('height') ?? '') || 300;
  return { width: Math.round(width), height: Math.round(height) };
}

const SVG = 'http://www.w3.org/2000/svg';

/** A soft shadow under boxes and participants, defined inside the drawing. */
function addShadow(svg: SVGSVGElement, theme: DiagramTheme) {
  const id = `${svg.id || 'diagram'}-shadow`;
  const { colour, near, far } = diagramShadow(theme);
  const defs = svg.ownerDocument.createElementNS(SVG, 'defs');
  const filter = svg.ownerDocument.createElementNS(SVG, 'filter');
  filter.setAttribute('id', id);
  for (const [name, value] of [
    ['x', '-20%'],
    ['y', '-20%'],
    ['width', '140%'],
    ['height', '170%'],
  ]) {
    filter.setAttribute(name!, value!);
  }
  for (const [dy, blur, opacity] of [
    [1, 1, near],
    [4, 5, far],
  ]) {
    const shadow = svg.ownerDocument.createElementNS(SVG, 'feDropShadow');
    shadow.setAttribute('dx', '0');
    shadow.setAttribute('dy', String(dy));
    shadow.setAttribute('stdDeviation', String(blur));
    shadow.setAttribute('flood-color', colour);
    shadow.setAttribute('flood-opacity', String(opacity));
    filter.append(shadow);
  }
  defs.append(filter);
  svg.prepend(defs);
  const shaded = [
    'g.node:not(.mm-sub) > :first-child',
    'g.node.mm-sub:not(.mm-plain) > :first-child',
    'rect.actor',
    'rect.note',
  ];
  const style = svg.ownerDocument.createElementNS(SVG, 'style');
  style.textContent = shaded.map((s) => `#${svg.id} ${s}`).join(',') + `{filter:url(#${id});}`;
  svg.append(style);
}

/** Each participant's activations in its own colour. */
function colourActivations(svg: SVGSVGElement, theme: DiagramTheme) {
  const lifelines = [...svg.querySelectorAll('line.actor-line')]
    .map((line) => Number.parseFloat(line.getAttribute('x1') ?? ''))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!lifelines.length) return;
  const hues = diagramHues(theme);
  for (const bar of svg.querySelectorAll<SVGRectElement>('rect[class^="activation"]')) {
    const x =
      Number.parseFloat(bar.getAttribute('x') ?? '0') +
      Number.parseFloat(bar.getAttribute('width') ?? '0') / 2;
    let nearest = 0;
    lifelines.forEach((line, i) => {
      if (Math.abs(line - x) < Math.abs(lifelines[nearest]! - x)) nearest = i;
    });
    bar.style.fill = hues[nearest % hues.length]!;
  }
}

/**
 * Boxes coloured with Memora's colours in their dark versions. The code's `classDef` lines
 * hold the light ones, which Mermaid writes onto each shape as `!important` styles.
 */
function darkenColours(svg: SVGSVGElement) {
  for (const colour of DIAGRAM_COLOURS) {
    const { fill, stroke, text } = DIAGRAM_SWATCHES[colour].dark;
    for (const node of svg.querySelectorAll(`g.${colourClass(colour)}`)) {
      for (const shape of node.querySelectorAll<SVGElement>(
        'rect, polygon, circle, ellipse, path',
      )) {
        if (shape.closest('.label')) continue;
        shape.style.setProperty('fill', fill, 'important');
        shape.style.setProperty('stroke', stroke, 'important');
      }
      for (const words of node.querySelectorAll<SVGElement>('text, tspan')) {
        words.style.setProperty('fill', text, 'important');
      }
    }
  }
}

/** Sanitises Mermaid's SVG, finishes Memora's look, labels it, and reads its size. */
function finish(raw: string, label: string, theme: DiagramTheme): Drawing {
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    RETURN_DOM_FRAGMENT: true,
  });
  const svg = clean.querySelector('svg');
  if (!svg) throw new DiagramError('The diagram couldn’t be drawn');
  // Mermaid leaves the words of some mind map shapes (circles, boxes, hexagons) starting at
  // the middle rather than centred on it.
  for (const words of svg.querySelectorAll<SVGGElement>('g.mindmap-node > g.label')) {
    if (!/^translate\(\s*0\s*,/.test(words.getAttribute('transform') ?? '')) continue;
    for (const text of words.querySelectorAll<SVGTextElement>('text')) {
      text.style.textAnchor = 'middle';
    }
  }
  addShadow(svg, theme);
  colourActivations(svg, theme);
  if (theme === 'dark') darkenColours(svg);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.removeAttribute('aria-roledescription');
  // Drawn at its natural size, never wider than the space it is in.
  const { width, height } = size(svg);
  svg.removeAttribute('height');
  svg.setAttribute('width', String(width));
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';
  // How far a page may shrink it (diagrams.css).
  svg.style.setProperty('--diagram-min', `${Math.round(width * 0.7)}px`);
  return { svg: svg.outerHTML, width, height };
}

async function draw(code: string, theme: DiagramTheme, label: string): Promise<Drawing> {
  const mermaid = await load();
  // Boxes are sized to their words: measured in Figtree, not a fallback still on screen.
  await document.fonts?.ready;
  const run = queue.then(async () => {
    mermaid.initialize(mermaidConfig(theme));
    const id = `memora-diagram-${++counter}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return finish(svg, label, theme);
    } catch (error) {
      throw new DiagramError(message(error));
    } finally {
      // Mermaid leaves its scratch element behind when it fails.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Draws a diagram in Memora's look; the same code and theme come from the cache. */
export function renderDiagram(
  code: string,
  theme: DiagramTheme,
  label = diagramSummary(code),
): Promise<Drawing> {
  const key = `${theme}\n${label}\n${code}`;
  const cached = cache.get(key);
  if (cached) {
    // Most recently used: kept longest.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const drawing = draw(code, theme, label);
  remember(key, drawing);
  return drawing;
}

/** Whether Mermaid can read the code; the reason when it can't. */
export async function checkDiagram(code: string): Promise<string | null> {
  const mermaid = await load();
  try {
    await mermaid.parse(code);
    return null;
  } catch (error) {
    return message(error);
  }
}

let fontData: Promise<string> | null = null;
const embeddedFont = () =>
  (fontData ??= fetch(figtreeUrl)
    .then((r) => r.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error('Couldn’t read the font'));
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => ''));

/**
 * A drawing for exports: light, with Figtree inside the SVG so a canvas (Word's image) draws
 * the text in the font the layout was measured with.
 */
export async function renderForExport(code: string, label?: string): Promise<Drawing> {
  const drawing = await renderDiagram(code, 'light', label);
  const font = await embeddedFont();
  if (!font) return drawing;
  const face = `@font-face{font-family:"Figtree Variable";font-weight:100 900;src:url(${font}) format("woff2");}`;
  return {
    ...drawing,
    svg: drawing.svg.replace(/<style>/, `<style>${face}`),
  };
}

/** Draws an SVG onto a canvas at `scale`, for a PNG of it. */
export async function svgToPng(drawing: Drawing, scale = 2): Promise<Blob> {
  const template = document.createElement('template');
  template.innerHTML = drawing.svg;
  const svg = template.content.querySelector('svg');
  if (!svg) throw new DiagramError('The diagram couldn’t be drawn');
  svg.setAttribute('width', String(drawing.width));
  svg.setAttribute('height', String(drawing.height));
  svg.style.removeProperty('max-width');
  svg.style.removeProperty('height');
  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = new OffscreenCanvas(
      Math.ceil(drawing.width * scale),
      Math.ceil(drawing.height * scale),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new DiagramError('No canvas to draw on');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
