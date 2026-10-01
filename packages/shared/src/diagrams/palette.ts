/*
 * The colours a diagram's boxes can have (§9.4): Memora's section hues (OKLCH, a soft fill,
 * a stronger edge and dark words), written into the code as
 * `classDef m-<name>` lines so the colours travel with it (GitHub draws them too). Memora
 * gives each its own dark version when the app is dark.
 */

export const DIAGRAM_COLOURS = [
  'blue',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'purple',
  'grey',
] as const;
export type DiagramColour = (typeof DIAGRAM_COLOURS)[number];

interface Swatch {
  label: string;
  fill: string;
  stroke: string;
  text: string;
  dark: { fill: string; stroke: string; text: string };
}

export const DIAGRAM_SWATCHES: Record<DiagramColour, Swatch> = {
  blue: {
    label: 'Blue',
    fill: '#ddf0ff',
    stroke: '#4c94ec',
    text: '#174276',
    dark: { fill: '#1d3451', stroke: '#6aa7f4', text: '#c4e1ff' },
  },
  teal: {
    label: 'Teal',
    fill: '#d2f8f2',
    stroke: '#00ae9e',
    text: '#005249',
    dark: { fill: '#003c37', stroke: '#00beaf', text: '#b2ece3' },
  },
  green: {
    label: 'Green',
    fill: '#dcf7e1',
    stroke: '#3eab5e',
    text: '#085023',
    dark: { fill: '#193b22', stroke: '#62bb78', text: '#c3eac9' },
  },
  yellow: {
    label: 'Yellow',
    fill: '#fff4be',
    stroke: '#d6a20a',
    text: '#633f00',
    dark: { fill: '#41340a', stroke: '#dab249', text: '#f3e5b0' },
  },
  orange: {
    label: 'Orange',
    fill: '#ffe7d7',
    stroke: '#d97230',
    text: '#6b2f01',
    dark: { fill: '#4b2915', stroke: '#e58b55', text: '#ffd3bb' },
  },
  red: {
    label: 'Red',
    fill: '#ffe5e1',
    stroke: '#df6862',
    text: '#6e2826',
    dark: { fill: '#4d2623', stroke: '#eb827b', text: '#ffcfca' },
  },
  purple: {
    label: 'Purple',
    fill: '#f2e9ff',
    stroke: '#a17adf',
    text: '#4b346f',
    dark: { fill: '#382b4d', stroke: '#b191ea', text: '#e4d6ff' },
  },
  grey: {
    label: 'Grey',
    fill: '#ebeff2',
    stroke: '#8894a0',
    text: '#3c434a',
    dark: { fill: '#2f3337', stroke: '#9ca6b1', text: '#dadfe4' },
  },
};

/** The class a colour is written as. */
export const colourClass = (colour: DiagramColour): string => `m-${colour}`;

/** The colour a class stands for, if it is one of Memora's. */
export function classColour(name: string): DiagramColour | null {
  const match = /^m-([a-z]+)$/.exec(name);
  return match && (DIAGRAM_COLOURS as readonly string[]).includes(match[1]!)
    ? (match[1] as DiagramColour)
    : null;
}

/** The `classDef` line for a colour, as Memora writes it. */
export const colourDefinition = (colour: DiagramColour): string => {
  const s = DIAGRAM_SWATCHES[colour];
  return `classDef ${colourClass(colour)} fill:${s.fill},stroke:${s.stroke},color:${s.text}`;
};
