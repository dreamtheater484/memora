import { chartMeaning, printGantt, printPie, printTimeline } from './chartsPrint';
import { flowchartMeaning, printFlowchart } from './flowchartPrint';
import type { DiagramModel } from './index';
import { mindmapMeaning, printMindmap } from './mindmapPrint';
import { printSequence, sequenceMeaning } from './sequencePrint';

/*
 * Writing diagrams back as code (§9.4), for the visual editor. Kept apart from reading them,
 * which snippets and search do on every page, so that the writing loads with the editor.
 */

export { chartMeaning, printGantt, printPie, printTimeline } from './chartsPrint';
export { flowchartMeaning, linkSyntax, nodeSyntax, printFlowchart } from './flowchartPrint';
export { mindmapMeaning, printMindmap } from './mindmapPrint';
export { printSequence, sequenceMeaning } from './sequencePrint';

/**
 * Writes a diagram back as code, changing as little of the code it was read from as it can
 * (§3.4): a model read and written without changes gives back the same code, byte for byte.
 */
export function printDiagram(model: DiagramModel): string {
  switch (model.type) {
    case 'flowchart':
      return printFlowchart(model);
    case 'sequence':
      return printSequence(model);
    case 'mindmap':
      return printMindmap(model);
    case 'timeline':
      return printTimeline(model);
    case 'gantt':
      return printGantt(model);
    case 'pie':
      return printPie(model);
  }
}

/**
 * What a model means, without how its code was written (`source`, `origin`, the order of
 * extras): two models that draw the same diagram have equal meanings.
 */
export function diagramMeaning(model: DiagramModel): unknown {
  switch (model.type) {
    case 'flowchart':
      return { ...flowchartMeaning(model), extras: [...model.extras].sort() };
    case 'sequence':
      return sequenceMeaning(model);
    case 'mindmap':
      return mindmapMeaning(model);
    case 'timeline':
      return chartMeaning.timeline(model);
    case 'gantt':
      return chartMeaning.gantt(model);
    case 'pie':
      return chartMeaning.pie(model);
  }
}
