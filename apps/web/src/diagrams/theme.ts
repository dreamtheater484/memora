import type { MermaidConfig } from 'mermaid';
import { oklch } from './oklch';

/*
 * Memora's look for diagrams (§9.4): Mermaid's `base` theme recoloured with Memora's own
 * colour system (the OKLCH section hues of tokens.css), its font, softly rounded shapes with
 * a light shadow (added in render.ts), crisp 1.5 px lines, in light and dark. Mermaid derives
 * its other colours from these, so they are plain hex values rather than CSS variables.
 */

export type DiagramTheme = 'light' | 'dark';

export const DIAGRAM_FONT = '"Figtree Variable", Figtree, system-ui, sans-serif';

/**
 * The hues branches take in turn (mind maps, timelines), as in sections.ts: indigo, teal,
 * amber, coral, cyan, violet, green, orange, magenta, blue, lime.
 */
const HUES = [275, 185, 75, 25, 215, 300, 150, 50, 330, 255, 125];
const ACCENT = 275;
const AMBER = 80;

/** One hue's colours. */
interface Tone {
  /** A strong fill, and the words on it. */
  solid: string;
  onSolid: string;
  /** A soft fill, and the words on it. */
  soft: string;
  ink: string;
  /** Lines and borders in this hue. */
  line: string;
}

function tone(theme: DiagramTheme, hue: number): Tone {
  if (theme === 'dark') {
    return {
      solid: oklch(0.72, 0.14, hue),
      onSolid: '#0b0c12',
      soft: oklch(0.31, 0.05, hue),
      ink: oklch(0.9, 0.06, hue),
      line: oklch(0.7, 0.13, hue),
    };
  }
  // Ambers, yellows and limes stay light, with dark words; the rest are deep, with white.
  const bright = hue >= 55 && hue <= 135;
  return {
    solid: bright ? oklch(0.82, 0.15, hue) : oklch(0.55, 0.16, hue),
    onSolid: bright ? oklch(0.28, 0.06, hue) : '#ffffff',
    soft: oklch(0.955, 0.035, hue),
    ink: oklch(0.38, 0.1, hue),
    line: oklch(0.66, 0.15, hue),
  };
}

interface Palette {
  text: string;
  muted: string;
  /** The page behind the diagram: edge labels are cut out of the lines with it. */
  page: string;
  node: string;
  nodeBorder: string;
  line: string;
  groupBg: string;
  groupBorder: string;
  lifeline: string;
  grid: string;
  /** A mind map's central topic. */
  root: string;
  rootText: string;
  /** Pie slices: one lightness for every hue, so one colour of words reads on all. */
  slice: (hue: number) => string;
  sliceText: string;
  accent: Tone;
  amber: Tone;
  coral: Tone;
  cyan: Tone;
  sections: Tone[];
}

function palette(theme: DiagramTheme): Palette {
  const t = (hue: number) => tone(theme, hue);
  const shared = {
    accent: t(ACCENT),
    amber: t(AMBER),
    coral: t(25),
    cyan: t(215),
    sections: HUES.map(t),
    slice: (hue: number) => oklch(0.72, 0.14, hue),
  };
  return theme === 'dark'
    ? {
        ...shared,
        text: '#eef0f7',
        muted: '#b0b5c7',
        page: '#161822',
        node: oklch(0.27, 0.025, ACCENT),
        nodeBorder: oklch(0.5, 0.07, ACCENT),
        line: oklch(0.72, 0.03, 270),
        groupBg: oklch(0.22, 0.015, ACCENT),
        groupBorder: oklch(0.36, 0.03, ACCENT),
        lifeline: oklch(0.45, 0.03, 270),
        grid: oklch(0.32, 0.02, 270),
        root: oklch(0.84, 0.08, ACCENT),
        rootText: '#0b0c12',
        sliceText: '#0b0c12',
      }
    : {
        ...shared,
        text: '#161822',
        muted: '#474c5e',
        page: '#ffffff',
        node: '#ffffff',
        nodeBorder: oklch(0.78, 0.06, ACCENT),
        line: oklch(0.56, 0.03, 270),
        groupBg: oklch(0.977, 0.008, ACCENT),
        groupBorder: oklch(0.88, 0.02, ACCENT),
        lifeline: oklch(0.82, 0.02, 270),
        grid: oklch(0.92, 0.01, 270),
        root: oklch(0.36, 0.12, ACCENT),
        rootText: '#ffffff',
        sliceText: '#161822',
      };
}

function variables(p: Palette, theme: DiagramTheme): Record<string, unknown> {
  // Timelines take cScale0, cScale1, … in turn; a mind map's branches start at cScale1.
  const sections = Object.fromEntries(
    [...p.sections, p.sections[0]!].flatMap((s, i) => [
      [`cScale${i}`, s.solid],
      [`cScaleLabel${i}`, s.onSolid],
      [`cScaleInv${i}`, s.line],
      [`cScalePeer${i}`, s.line],
    ]),
  );
  const slices = Object.fromEntries([...HUES, 250].map((hue, i) => [`pie${i + 1}`, p.slice(hue)]));
  return {
    darkMode: theme === 'dark',
    background: 'transparent',
    fontFamily: DIAGRAM_FONT,
    fontSize: '15px',
    textColor: p.text,
    titleColor: p.text,
    lineColor: p.line,
    arrowheadColor: p.line,
    primaryColor: p.node,
    primaryBorderColor: p.nodeBorder,
    primaryTextColor: p.text,
    secondaryColor: p.groupBg,
    tertiaryColor: p.groupBg,
    mainBkg: p.node,
    nodeBorder: p.nodeBorder,
    nodeTextColor: p.text,
    clusterBkg: p.groupBg,
    clusterBorder: p.groupBorder,
    edgeLabelBackground: p.page,
    // Sequence diagrams.
    actorBkg: p.node,
    actorBorder: p.nodeBorder,
    actorTextColor: p.text,
    actorLineColor: p.lifeline,
    signalColor: p.line,
    signalTextColor: p.text,
    labelBoxBkgColor: p.accent.soft,
    labelBoxBorderColor: p.accent.line,
    labelTextColor: p.accent.ink,
    loopTextColor: p.muted,
    noteBkgColor: p.amber.soft,
    noteBorderColor: p.amber.line,
    noteTextColor: p.amber.ink,
    activationBkgColor: p.accent.solid,
    activationBorderColor: p.accent.solid,
    sequenceNumberColor: p.accent.onSolid,
    // Gantt charts.
    sectionBkgColor: p.groupBg,
    altSectionBkgColor: 'transparent',
    sectionBkgColor2: p.groupBg,
    taskBkgColor: p.accent.solid,
    taskBorderColor: p.accent.solid,
    taskTextColor: p.accent.onSolid,
    taskTextLightColor: p.accent.onSolid,
    taskTextDarkColor: p.cyan.onSolid,
    taskTextOutsideColor: p.text,
    taskTextClickableColor: p.accent.ink,
    activeTaskBkgColor: p.cyan.solid,
    activeTaskBorderColor: p.cyan.solid,
    doneTaskBkgColor: p.accent.soft,
    doneTaskBorderColor: p.accent.soft,
    critBkgColor: p.coral.solid,
    critBorderColor: p.coral.solid,
    gridColor: p.grid,
    todayLineColor: p.coral.line,
    // Pie charts.
    pieTitleTextColor: p.text,
    pieSectionTextColor: p.sliceText,
    pieSectionTextSize: '14px',
    pieLegendTextColor: p.text,
    pieLegendTextSize: '14px',
    pieStrokeColor: p.page,
    pieStrokeWidth: '2px',
    pieOuterStrokeWidth: '0px',
    pieOpacity: '1',
    // Mind maps' central topic.
    git0: p.root,
    gitBranchLabel0: p.rootText,
    ...sections,
    ...slices,
  };
}

/**
 * Shapes, lines and words in Memora's style. Mermaid scopes these rules to the diagram.
 * Mind map topics get their depth from mindmapLayout.ts (`mm-root`, `mm-main`, `mm-sub`, and
 * `mm-plain` for topics without a shape).
 */
function css(p: Palette): string {
  const rules = [
    // Flowcharts.
    '.node rect, .node .basic.label-container { rx: 8px; ry: 8px; }',
    '.node .label-container, .node > rect, .node > polygon, .node > circle, .node > path { stroke-width: 1.5px; }',
    '.node text, .node .nodeLabel { font-weight: 500; }',
    '.cluster rect { rx: 12px; ry: 12px; stroke-width: 1px; }',
    `.cluster text, .cluster .nodeLabel { fill: ${p.muted}; font-weight: 600; }`,
    '.edgeLabel rect, .labelBkg { rx: 6px; ry: 6px; }',
    `.edgeLabel text, .edgeLabel tspan { fill: ${p.muted}; }`,
    '.edge-thickness-normal { stroke-width: 1.5px; }',
    '.edge-thickness-thick { stroke-width: 3px; }',
    '.flowchart-link { stroke-linecap: round; stroke-linejoin: round; }',
    // Sequence diagrams.
    '.actor { rx: 10px; ry: 10px; stroke-width: 1.5px; }',
    'text.actor, text.actor > tspan { font-weight: 600; }',
    '.actor-line { stroke-dasharray: 5 5; stroke-width: 1.25px; }',
    '.messageLine0, .messageLine1 { stroke-width: 1.5px; }',
    `.messageText { fill: ${p.text}; font-weight: 500; }`,
    '.note { rx: 10px; ry: 10px; stroke-width: 1px; }',
    `.loopLine { stroke: ${p.groupBorder}; stroke-width: 1.25px; stroke-dasharray: 4 4; }`,
    '.labelBox { stroke: none; }',
    '.labelText, .labelText > tspan { font-weight: 600; }',
    '.loopText, .loopText > tspan { font-style: italic; }',
    '.activation0, .activation1, .activation2 { rx: 3px; ry: 3px; stroke: none !important; }',
    `marker[id$="sequencenumber"] circle { fill: ${p.accent.solid}; }`,
    'text.sequenceNumber { font-weight: 700; }',
    // Gantt charts.
    '.task { rx: 6px; ry: 6px; }',
    '.taskText, .taskTextOutsideRight, .taskTextOutsideLeft { font-weight: 500; }',
    `.doneText0, .doneText1, .doneText2, .doneText3 { fill: ${p.accent.ink} !important; }`,
    `.sectionTitle, .sectionTitle0, .sectionTitle1, .sectionTitle2, .sectionTitle3 { fill: ${p.muted} !important; font-weight: 600; }`,
    `.grid .tick line { stroke: ${p.grid}; stroke-width: 1px; opacity: 1; }`,
    '.grid path { stroke-width: 0; }',
    `.grid .tick text { fill: ${p.muted}; font-size: 12px; }`,
    '.titleText { font-weight: 700; }',
    // Pie charts.
    '.pieTitleText { font-weight: 700; }',
    '.slice { font-weight: 600; }',
    // Timelines.
    '.timeline-node line { display: none; }',
    '.timeline-node text { font-size: 16px; font-weight: 600; }',
    '.eventWrapper .timeline-node text { font-weight: 500; }',
    `.lineWrapper line { stroke: ${p.line}; stroke-width: 2px; }`,
    `.lineWrapper line[stroke-dasharray] { stroke: ${p.lifeline}; stroke-width: 1.25px; stroke-dasharray: 4 4; }`,
    `marker[id$="arrowhead"] path { fill: ${p.line}; stroke: none; }`,
    // Mind maps: the centre, its main topics filled, deeper topics underlined (or softly
    // filled when they have a shape), and branches tapering away from the centre.
    '.mindmap-node .node-bkg, .mindmap-node .label-container { stroke-width: 0; }',
    '.mm-root text, .mm-main text { font-weight: 600; }',
    '.mm-sub text { font-weight: 500; }',
    '.mm-root line, .mm-main line { display: none; }',
    '.mindmap-node.mm-sub.mm-plain .node-bkg { fill: transparent !important; }',
    `.mindmap-node.mm-sub.mm-plain text { fill: ${p.text} !important; }`,
    '.mindmap-node.mm-sub.mm-plain line { stroke-width: 2.5px; stroke-linecap: round; }',
    '.mm-branch { fill: none; stroke-linecap: round; stroke-width: 1.75px; }',
    '.mm-branch.mm-depth-1 { stroke-width: 3.5px; }',
    '.mm-branch.mm-depth-2 { stroke-width: 2.5px; }',
    '.mm-branch.mm-depth-3 { stroke-width: 2px; }',
  ];
  // Each branch in its own hue (Mermaid's section-0 is cScale1): the line, and the softer
  // fill of deeper shaped topics.
  p.sections.forEach((_, i) => {
    const s = p.sections[(i + 1) % p.sections.length]!;
    rules.push(
      `.mm-branch.mm-section-${i} { stroke: ${s.line}; }`,
      `.mindmap-node.section-${i}.mm-plain line { stroke: ${s.line}; }`,
      `.mindmap-node.section-${i}.mm-sub:not(.mm-plain) .label-container, .mindmap-node.section-${i}.mm-sub:not(.mm-plain) .node-bkg { fill: ${s.soft} !important; stroke: ${s.line}; stroke-width: 1.5px; }`,
      `.mindmap-node.section-${i}.mm-sub:not(.mm-plain) text { fill: ${s.ink} !important; }`,
    );
  });
  // A timeline's events softer than its periods; Mermaid numbers its sections from -1.
  for (let i = -1; i < p.sections.length; i++) {
    const s = p.sections[(i + 1) % p.sections.length]!;
    rules.push(
      `.eventWrapper .section-${i} path, .eventWrapper .section-${i} rect { fill: ${s.soft} !important; stroke: ${s.line}; stroke-width: 1px; }`,
      `.eventWrapper .section-${i} text { fill: ${s.ink} !important; }`,
    );
  }
  return rules.join('\n');
}

/** The strong colours of the branch hues, in order (sequence diagrams' activations). */
export const diagramHues = (theme: DiagramTheme): string[] =>
  HUES.map((hue) => tone(theme, hue).solid);

/** The soft shadow under boxes, as render.ts draws it. */
export function diagramShadow(theme: DiagramTheme): { colour: string; near: number; far: number } {
  return theme === 'dark'
    ? { colour: '#000000', near: 0.35, far: 0.3 }
    : { colour: '#282c5a', near: 0.08, far: 0.09 };
}

/** Mermaid's configuration for Memora's look. */
export function mermaidConfig(theme: DiagramTheme): MermaidConfig {
  const p = palette(theme);
  return {
    startOnLoad: false,
    // No scripts, no click handlers, sanitised labels.
    securityLevel: 'strict',
    // Labels as SVG text: safe, and drawable onto a canvas for Word exports.
    htmlLabels: false,
    suppressErrorRendering: true,
    theme: 'base',
    look: 'classic',
    fontFamily: DIAGRAM_FONT,
    themeVariables: variables(p, theme),
    themeCSS: css(p),
    flowchart: { curve: 'rounded', padding: 16, nodeSpacing: 48, rankSpacing: 56 },
    sequence: {
      mirrorActors: false,
      boxMargin: 10,
      noteMargin: 12,
      messageMargin: 40,
      height: 48,
      actorFontWeight: 600,
      messageFontWeight: 500,
      noteFontWeight: 400,
    },
    // Gantt charts are as wide as their container; drawn off-screen, that's the window.
    gantt: {
      useWidth: 760,
      axisFormat: '%e %b',
      barHeight: 28,
      barGap: 8,
      topPadding: 56,
      fontSize: 14,
      sectionFontSize: 14,
    },
    mindmap: { padding: 16 },
    timeline: { padding: 8, leftMargin: 16 },
  };
}
