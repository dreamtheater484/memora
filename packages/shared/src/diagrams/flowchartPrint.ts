import { INDENT } from './common';
import { classColour, colourClass, colourDefinition, type DiagramColour } from './palette';
import { common, indentOf, originsOf, printChecked, sameBag, sameJson } from './source';
import {
  type Flowchart,
  type FlowDirection,
  type FlowEdge,
  type FlowGroup,
  type FlowHead,
  type FlowLayout,
  type FlowNode,
  isFlowId,
  type LinkLayout,
  type RefLayout,
  type Statement,
  flowchartSyntax,
} from './flowchart';

const { labelText, readFlowchartCode, SHAPES } = flowchartSyntax;

/*
 * Flowcharts written back as Mermaid code (§9.4), changing as little of the code they
 * were read from as possible. Apart from the reading, so that what only reads diagrams
 * (snippets, search) does not load the writing.
 */

/** A box as written in its declaration. */
export function nodeSyntax(node: Pick<FlowNode, 'id' | 'label' | 'shape' | 'classes'>): string {
  const classes = node.classes.map((c) => `:::${c}`).join('');
  if (node.label === node.id && node.shape === 'rect') return `${node.id}${classes}`;
  const [open, close] = SHAPES[node.shape];
  return `${node.id}${open}${labelText(node.label)}${close}${classes}`;
}

/** An arrow without its label. */
function arrowSyntax(edge: Pick<FlowEdge, 'line' | 'start' | 'end' | 'extra'>): string {
  const head = (h: FlowHead, start: boolean) =>
    h === 'none' ? '' : h === 'arrow' ? (start ? '<' : '>') : h === 'cross' ? 'x' : 'o';
  const s = head(edge.start, true);
  const e = head(edge.end, false);
  switch (edge.line) {
    case 'invisible':
      return '~'.repeat(3 + edge.extra);
    case 'dotted':
      return `${s}-${'.'.repeat(1 + edge.extra)}-${e}`;
    case 'thick':
      return e ? `${s}${'='.repeat(2 + edge.extra)}${e}` : `${s}${'='.repeat(3 + edge.extra)}`;
    default:
      return e ? `${s}${'-'.repeat(2 + edge.extra)}${e}` : `${s}${'-'.repeat(3 + edge.extra)}`;
  }
}

/** An arrow's label between bars. */
const barLabel = (label: string, quote = false) => labelText(label, quote);

/** An arrow as written between two boxes. */
export function linkSyntax(edge: Pick<FlowEdge, 'line' | 'start' | 'end' | 'extra' | 'label'>) {
  const arrow = arrowSyntax(edge);
  return edge.label ? `${arrow}|${barLabel(edge.label)}|` : arrow;
}

const directionName = (d: FlowDirection) => (d === 'TB' ? 'TD' : d);

/** A group's `subgraph` line. */
const groupLine = (g: Pick<FlowGroup, 'id' | 'label'>) =>
  g.label === g.id && isFlowId(g.id)
    ? `subgraph ${g.id}`
    : `subgraph ${g.id} [${labelText(g.label)}]`;

/** Writes a flowchart afresh, in the tidy layout. */
function writeTidy(chart: Flowchart, eol = '\n'): string {
  const out = [`${chart.keyword} ${directionName(chart.direction)}`];
  const write = (depth: number, text: string) => out.push(INDENT.repeat(depth) + text);
  const writeGroup = (group: FlowGroup | null, depth: number) => {
    if (group) {
      write(depth, groupLine(group));
      if (group.direction) write(depth + 1, `direction ${group.direction}`);
    }
    const inner = group ? depth + 1 : depth;
    for (const node of chart.nodes) {
      if (node.group === (group?.id ?? null)) write(inner, nodeSyntax(node));
    }
    for (const child of chart.groups) {
      if (child.parent === (group?.id ?? null)) writeGroup(child, inner);
    }
    if (group) write(depth, 'end');
  };
  writeGroup(null, 1);
  for (const edge of chart.edges) write(1, `${edge.from} ${linkSyntax(edge)} ${edge.to}`);
  const colours = new Map<DiagramColour, string[]>();
  for (const node of chart.nodes) {
    if (node.colour) colours.set(node.colour, [...(colours.get(node.colour) ?? []), node.id]);
  }
  for (const [colour, ids] of colours) {
    write(1, colourDefinition(colour));
    write(1, `class ${ids.join(',')} ${colourClass(colour)}`);
  }
  for (const extra of chart.extras) for (const line of extra.split('\n')) write(1, line);
  return [...chart.head, ...out].join(eol);
}

/** Whether a label can go between `-- ` and ` -->` as written. */
const middleSafe = (label: string) =>
  /^[\p{L}\p{N}][\p{L}\p{N} ,!?']*$/u.test(label) && label.trim() === label;

/** What happens to a statement: kept as written, dropped, or written as these statements. */
type Outcome = 'keep' | 'drop' | string[];

/**
 * Writes a flowchart changing as little of its source as possible: statements whose boxes and
 * arrows didn't change are kept as written; changed ones are rewritten in place (a chain stays
 * a chain, and is split only where an arrow went); new boxes go at the end of their group, new
 * groups at the end of theirs, new arrows after everything; colours join the class lines.
 */
function writeMinimal(chart: Flowchart, layout: FlowLayout): string {
  const was = layout.was;
  const lines = layout.lines;
  // What each item of the source is now.
  const wasNodes = new Map(was.nodes.map((n) => [n.id, n]));
  const nodeNow = new Map(chart.nodes.map((n) => [n.id, n]));
  const nodeKeys = originsOf(chart.nodes, was.nodes.length, new Set());
  const before = new Map<FlowNode, FlowNode>();
  chart.nodes.forEach((n, i) => {
    const k = nodeKeys[i];
    if (k !== null && k !== undefined && was.nodes[k]!.id === n.id) before.set(n, was.nodes[k]!);
  });
  const edgeKeys = originsOf(chart.edges, was.edges.length, new Set());
  const edgeNow = new Map<number, FlowEdge>();
  edgeKeys.forEach((k, i) => k !== null && edgeNow.set(k, chart.edges[i]!));
  const edgeIndex = new Map(chart.edges.map((e, i) => [e, i]));
  const groupKeys = originsOf(chart.groups, was.groups.length, new Set());
  const groupNow = new Map<number, FlowGroup>();
  groupKeys.forEach((k, i) => {
    if (k !== null && was.groups[k]!.id === chart.groups[i]!.id) groupNow.set(k, chart.groups[i]!);
  });
  const originOfGroup = new Map([...groupNow].map(([origin, g]) => [g, origin]));
  const groupById = new Map(chart.groups.map((g) => [g.id, g]));
  const live = (id: string) => nodeNow.has(id) || groupById.has(id);
  const removedGroup = (origin: number) => !groupNow.has(origin);

  const labelChanged = (n: FlowNode) => {
    const b = before.get(n);
    return !b || b.label !== n.label || b.shape !== n.shape;
  };
  const colourChanged = (n: FlowNode) => !before.has(n) || before.get(n)!.colour !== n.colour;
  const classesChanged = (n: FlowNode) => {
    const b = before.get(n);
    return !b || !sameJson([...b.classes].sort(), [...n.classes].sort());
  };
  const plain = (n: FlowNode) => n.label === n.id && n.shape === 'rect';

  // Every box written in a chain, in order, and how each is written now.
  const refsOf = new Map<string, RefLayout[]>();
  for (const line of lines) {
    for (const st of line.statements) {
      if (st.kind !== 'chain') continue;
      for (const list of st.lists) {
        for (const ref of list.refs) refsOf.set(ref.id, [...(refsOf.get(ref.id) ?? []), ref]);
      }
    }
  }
  interface RefPlan {
    /** It gives the box's label and shape. */
    declare: boolean;
    /** Its classes now (Memora colours included), or null to keep them as written. */
    classes: string[] | null;
    /** Keep it even when no arrow is left on it. */
    keep: boolean;
  }
  const plans = new Map<RefLayout, RefPlan>();
  const inlineColour = new Set<string>();
  for (const [id, refs] of refsOf) {
    const node = nodeNow.get(id);
    if (!node) continue;
    const declaring = refs.filter((r) => r.declares);
    const site = declaring[0] ?? refs[0]!;
    for (const ref of refs) plans.set(ref, { declare: ref.declares, classes: null, keep: false });
    // A box that gets a label where it had none gets it where it is first named.
    if (labelChanged(node) && !declaring.length && !plain(node)) {
      plans.get(site)!.declare = true;
      plans.get(site)!.keep = true;
    }
    if (classesChanged(node) || colourChanged(node)) {
      const colourRef = [...refs].reverse().find((r) => r.classes.some((c) => classColour(c)));
      for (const ref of refs) {
        let classes = ref.classes;
        if (colourChanged(node)) classes = classes.filter((c) => !classColour(c));
        if (classesChanged(node)) classes = classes.filter((c) => classColour(c));
        plans.get(ref)!.classes = classes;
      }
      if (classesChanged(node) && node.classes.length) {
        plans.get(site)!.classes!.push(...node.classes);
        plans.get(site)!.keep = true;
      }
      if (colourChanged(node) && node.colour && colourRef) {
        plans.get(colourRef)!.classes!.push(colourClass(node.colour));
        plans.get(colourRef)!.keep = true;
        inlineColour.add(id);
      }
    }
  }

  const refText = (ref: RefLayout, s: string): string => {
    const raw = s.slice(ref.start, ref.end);
    const node = nodeNow.get(ref.id);
    const plan = plans.get(ref);
    if (!node || !plan) return raw;
    const written = s.slice(ref.start + ref.id.length, ref.end).replace(/(?::::[\w-]+)+$/, '');
    const [open, close] = SHAPES[node.shape];
    let declaration = '';
    if (ref.declares && !labelChanged(node)) declaration = written;
    else if (plan.declare && !plain(node)) {
      declaration = `${open}${labelText(node.label, ref.quoted)}${close}`;
    }
    return ref.id + declaration + (plan.classes ?? ref.classes).map((c) => `:::${c}`).join('');
  };
  const refMatters = (ref: RefLayout) => {
    const plan = plans.get(ref);
    return !!plan && (plan.keep || plan.declare || (plan.classes ?? ref.classes).length > 0);
  };

  const linkText = (link: LinkLayout, s: string, edge: FlowEdge): string => {
    const w = link.link;
    const arrowSame =
      w.line === edge.line &&
      w.start === edge.start &&
      w.end === edge.end &&
      w.extra === edge.extra;
    if (arrowSame && w.label === edge.label) return s.slice(link.start, link.end);
    if (arrowSame && link.middle && edge.label && middleSafe(edge.label)) {
      return s.slice(link.start, link.middle[0]) + edge.label + s.slice(link.middle[1], link.end);
    }
    const arrow =
      arrowSame && !link.middle ? s.slice(link.start, link.arrowEnd) : arrowSyntax(edge);
    return edge.label ? `${arrow}|${barLabel(edge.label, link.quoted)}|` : arrow;
  };

  const sameLook = (a: FlowEdge, b: FlowEdge) =>
    a.label === b.label &&
    a.line === b.line &&
    a.start === b.start &&
    a.end === b.end &&
    a.extra === b.extra;

  /** A chain: kept, or rewritten where boxes or arrows changed, split where an arrow went. */
  const chainOutcome = (st: Extract<Statement, { kind: 'chain' }>): Outcome => {
    const s = st.text;
    const lists = st.lists.map((l) => l.refs.filter((r) => live(r.id)));
    const listText = (k: number) => {
      const list = st.lists[k]!;
      if (lists[k]!.length === list.refs.length) {
        let text = s.slice(list.start, list.end);
        for (const ref of [...list.refs].reverse()) {
          text =
            text.slice(0, ref.start - list.start) +
            refText(ref, s) +
            text.slice(ref.end - list.start);
        }
        return text;
      }
      return lists[k]!.map((r) => refText(r, s)).join(' & ');
    };
    const pieces: string[] = [];
    let from = 0;
    let links: number[] = [];
    const close = (next: number) => {
      if (links.length) {
        let text = listText(from);
        for (const k of links) {
          const link = st.links[k]!;
          const edge = edgeNow.get(link.edges.find((o) => edgeNow.has(o))!)!;
          const arrowText = linkText(link, s, edge);
          // A head written right after a box (`Bx-->C`) would be read as part of its id.
          const gap = s.slice(st.lists[k]!.end, link.start) || (/^[xo]/.test(arrowText) ? ' ' : '');
          text += gap + arrowText + s.slice(link.end, st.lists[k + 1]!.start) + listText(k + 1);
        }
        pieces.push(text);
      } else if (!st.links.length) {
        // A statement that only names boxes keeps those still there.
        if (lists[from]!.length) pieces.push(listText(from));
      } else {
        // Boxes left without an arrow stay where they say something.
        for (const ref of lists[from]!) if (refMatters(ref)) pieces.push(refText(ref, s));
      }
      from = next;
      links = [];
    };
    st.links.forEach((link, k) => {
      const left = new Set(lists[k]!.map((r) => r.id));
      const right = new Set(lists[k + 1]!.map((r) => r.id));
      const present = link.edges
        .filter((o) => edgeNow.has(o))
        .sort((a, b) => edgeIndex.get(edgeNow.get(a)!)! - edgeIndex.get(edgeNow.get(b)!)!);
      const expected = link.edges.filter((o) => {
        const e = was.edges[o]!;
        return left.has(e.from) && right.has(e.to);
      });
      const first = present[0] === undefined ? undefined : edgeNow.get(present[0]);
      const holds =
        left.size > 0 &&
        right.size > 0 &&
        sameJson(present, expected) &&
        present.every((o) => {
          const e = edgeNow.get(o)!;
          const w = was.edges[o]!;
          return e.from === w.from && e.to === w.to && sameLook(e, first!);
        });
      if (holds) {
        links.push(k);
        return;
      }
      close(k + 1);
      // What is left of this link, as arrows of their own.
      for (const o of present) {
        const e = edgeNow.get(o)!;
        pieces.push(`${e.from} ${linkSyntax(e)} ${e.to}`);
      }
    });
    close(st.lists.length);
    if (pieces.length === 1 && pieces[0] === s) return 'keep';
    return pieces.length ? pieces : 'drop';
  };

  // Colours: which class lines name which boxes now.
  const usedBefore = new Set(was.nodes.map((n) => n.colour).filter(Boolean));
  const usedNow = new Set(chart.nodes.map((n) => n.colour).filter(Boolean));
  const classLines: { line: number; index: number; colour: DiagramColour; ids: string[] }[] = [];
  const defined = new Set<DiagramColour>();

  const extraPairs = common(was.extras, chart.extras);
  const keptExtras = new Set(extraPairs.map(([b]) => b));
  const newExtras = chart.extras.filter((_, j) => !extraPairs.some(([, a]) => a === j));

  /** Each line's statements now. */
  const outcomes: Outcome[][] = lines.map((line, li) =>
    line.statements.map((st, si): Outcome => {
      switch (st.kind) {
        case 'extra':
          return keptExtras.has(st.extra) ? 'keep' : 'drop';
        case 'colourDef':
          if (!usedNow.has(st.colour) && usedBefore.has(st.colour)) return 'drop';
          defined.add(st.colour);
          return 'keep';
        case 'colourClass': {
          const ids = st.ids.filter((id) => {
            const node = nodeNow.get(id);
            if (!wasNodes.has(id)) return true;
            if (!node) return false;
            return !colourChanged(node) || node.colour === st.colour;
          });
          if (!ids.length) return 'drop';
          classLines.push({ line: li, index: si, colour: st.colour, ids });
          return 'keep';
        }
        case 'subgraph': {
          const group = groupNow.get(st.group);
          if (!group) return 'drop';
          const w = was.groups[st.group]!;
          if (group.label === w.label) return 'keep';
          // A group named only by its title (with spaces, so Mermaid numbers it) stays so.
          const titled =
            st.titleOnly &&
            /\s/.test(w.label) &&
            /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)+$/.test(group.label);
          return [titled ? `subgraph ${group.label}` : groupLine(group)];
        }
        case 'end':
          return removedGroup(st.group) ? 'drop' : 'keep';
        case 'direction': {
          const group = groupNow.get(st.group);
          if (!group?.direction) return 'drop';
          return group.direction === was.groups[st.group]!.direction
            ? 'keep'
            : [`direction ${group.direction}`];
        }
        case 'chain':
          return chainOutcome(st);
      }
    }),
  );

  // Where things are added: at the end of a group (before its `end`), after a group's line,
  // in a new group, or at the end of the top level (before the styles and colours after it).
  const topIndent = lines.find((l) => l.text.trim() !== '')?.indent || INDENT;
  const stepIn = (() => {
    for (const block of layout.blocks) {
      const inner = lines.slice(block.open + 1, block.close).find((l) => l.text.trim() !== '');
      const own = lines[block.open]!.indent;
      if (inner && inner.indent.length > own.length && inner.indent.startsWith(own)) {
        return inner.indent.slice(own.length);
      }
    }
    // No group to learn from: a step as deep as the top level's.
    return /^ +$/.test(topIndent) ? topIndent : INDENT;
  })();
  const innerIndent = (origin: number) => {
    const block = layout.blocks[origin]!;
    const inner = lines.slice(block.open + 1, block.close).find((l) => l.text.trim() !== '');
    return inner?.indent ?? lines[block.open]!.indent + stepIn;
  };
  let lastTop = -1;
  lines.forEach((line, i) => {
    if (!line.within.length && line.statements.some((s) => s.kind === 'chain')) lastTop = i;
  });
  for (const block of layout.blocks) {
    if (!lines[block.open]!.within.length) lastTop = Math.max(lastTop, block.close);
  }

  type Added = { text: string } | { group: FlowGroup };
  const adds = new Map<string, Added[]>();
  const add = (where: string, item: Added) => adds.set(where, [...(adds.get(where) ?? []), item]);
  const newGroup = (g: FlowGroup) => !originOfGroup.has(g);
  /** Where a group's new lines go. */
  const placeOf = (group: string | null): string => {
    if (group === null) return 'top';
    const g = groupById.get(group);
    if (!g) return 'top';
    const origin = originOfGroup.get(g);
    return origin === undefined ? `group:${g.id}` : `close:${layout.blocks[origin]!.close}`;
  };

  // Boxes the code doesn't name yet, in their groups.
  for (const node of chart.nodes) {
    if (!refsOf.has(node.id)) add(placeOf(node.group), { text: nodeSyntax(node) });
  }
  // Boxes put in a new group are named in it.
  for (const node of chart.nodes) {
    const g = node.group === null ? undefined : groupById.get(node.group);
    if (refsOf.has(node.id) && g && newGroup(g)) add(placeOf(node.group), { text: node.id });
  }
  // New groups, at the end of their parents; but Mermaid puts a box in the first group to
  // close that names it, so a new group whose boxes a group beside it names goes before that.
  const mentionedIn = new Map<string, Set<number>>();
  for (const line of lines) {
    const inner = line.within.at(-1);
    if (inner === undefined) continue;
    for (const st of line.statements) {
      if (st.kind !== 'chain') continue;
      for (const ref of st.lists.flatMap((l) => l.refs)) {
        mentionedIn.set(ref.id, (mentionedIn.get(ref.id) ?? new Set()).add(inner));
      }
    }
  }
  const originById = new Map(was.groups.map((g, origin) => [g.id, origin]));
  /** The block in a parent (by origin, or the top level) that holds a group, if any. */
  const holder = (origin: number, parent: number | null): number | null => {
    let at: number | null = origin;
    while (at !== null) {
      const up: string | null = was.groups[at]!.parent;
      const upOrigin: number | null = up === null ? null : originById.get(up)!;
      if (upOrigin === parent) return at;
      at = upOrigin;
    }
    return null;
  };
  const membersOf = (g: FlowGroup): FlowNode[] => [
    ...chart.nodes.filter((n) => n.group === g.id),
    ...chart.groups.filter((c) => c.parent === g.id && newGroup(c)).flatMap(membersOf),
  ];
  for (const g of chart.groups) {
    if (!newGroup(g) || (g.parent !== null && newGroup(groupById.get(g.parent) ?? g))) {
      if (newGroup(g)) add(placeOf(g.parent), { group: g });
      continue;
    }
    const parent = g.parent === null ? null : (originOfGroup.get(groupById.get(g.parent)!) ?? null);
    let first: number | null = null;
    for (const node of membersOf(g)) {
      for (const origin of mentionedIn.get(node.id) ?? []) {
        if (removedGroup(origin) || origin === parent) continue;
        const block = holder(origin, parent);
        if (
          block !== null &&
          (first === null || layout.blocks[block]!.open < layout.blocks[first]!.open)
        ) {
          first = block;
        }
      }
    }
    add(first === null ? placeOf(g.parent) : `before:${layout.blocks[first]!.open}`, { group: g });
  }
  // Directions given to groups that had none.
  layout.blocks.forEach((block, origin) => {
    const group = groupNow.get(origin);
    if (group?.direction && !was.groups[origin]!.direction) {
      add(`open:${block.open}`, { text: `direction ${group.direction}` });
    }
  });
  // New arrows, after everything.
  chart.edges.forEach((edge, i) => {
    if (edgeKeys[i] === null) add('top', { text: `${edge.from} ${linkSyntax(edge)} ${edge.to}` });
  });
  // Colours: a box that changed colour joins a class line of it.
  const addColour = (node: FlowNode) => {
    const line = [...classLines].reverse().find((c) => c.colour === node.colour);
    if (line) {
      if (!line.ids.includes(node.id)) line.ids.push(node.id);
    } else classLines.push({ line: -1, index: -1, colour: node.colour!, ids: [node.id] });
  };
  for (const node of chart.nodes) {
    if (!node.colour || !colourChanged(node) || inlineColour.has(node.id)) continue;
    if (classLines.some((c) => c.colour === node.colour && c.ids.includes(node.id))) continue;
    addColour(node);
  }
  const explicitLines = new Map<number, string>();

  const render = (): string => {
    const out: string[] = [];
    const written = (where: string, indent: string): string[] =>
      (adds.get(where) ?? []).flatMap((item) => {
        if ('text' in item) return [indent + item.text];
        const g = item.group;
        return [
          indent + groupLine(g),
          ...(g.direction ? [`${indent}${stepIn}direction ${g.direction}`] : []),
          ...written(`group:${g.id}`, indent + stepIn),
          `${indent}end`,
        ];
      });
    // New colour lines go after the last colour statement at the top level, else after
    // what is added at the end of the top level.
    let colourAt = -1;
    lines.forEach((line, i) => {
      if (line.within.length) return;
      const colours = line.statements.some(
        (s) => s.kind === 'colourDef' || s.kind === 'colourClass',
      );
      if (colours && outcomes[i]!.some((o) => o !== 'drop')) colourAt = i;
    });
    const colourLines: string[] = [];
    const definedHere = new Set(defined);
    for (const c of classLines.filter((x) => x.line < 0)) {
      if (!definedHere.has(c.colour)) {
        colourLines.push(topIndent + colourDefinition(c.colour));
        definedHere.add(c.colour);
      }
      colourLines.push(`${topIndent}class ${c.ids.join(',')} ${colourClass(c.colour)}`);
    }
    const lineText = (i: number): string[] | null => {
      const line = lines[i]!;
      const results = outcomes[i]!.map((o, si): Outcome => {
        const st = line.statements[si]!;
        if (st.kind === 'subgraph' && explicitLines.has(st.group))
          return [explicitLines.get(st.group)!];
        if (st.kind === 'colourClass') {
          const c = classLines.find((x) => x.line === i && x.index === si);
          if (c && !sameJson(c.ids, st.ids))
            return [`class ${c.ids.join(',')} ${colourClass(c.colour)}`];
        }
        return o;
      });
      if (results.every((o) => o === 'keep')) return line.text.split('\n');
      if (results.every((o) => o === 'drop')) return null;
      if (line.statements.length === 1) {
        const st = line.statements[0]!;
        const texts = results[0] as string[];
        if (texts.length === 1)
          return [line.text.slice(0, st.start) + texts[0] + line.text.slice(st.end)];
        return texts.map((t) => line.indent + t);
      }
      // Several statements on a line: each rewritten in place.
      let text = line.text;
      for (let si = line.statements.length - 1; si >= 0; si -= 1) {
        const st = line.statements[si]!;
        const o = results[si]!;
        if (o === 'keep') continue;
        if (o === 'drop') {
          const rest = text.slice(st.end);
          const sep = /^\s*;\s*/.exec(rest)?.[0] ?? '';
          text = text.slice(0, st.start) + rest.slice(sep.length);
        } else text = text.slice(0, st.start) + o.join('; ') + text.slice(st.end);
      }
      return text.trim().replace(/;$/, '') ? [text.trimEnd()] : null;
    };
    // Lines in removed groups move out a level.
    const outdent = lines.map(() => 0);
    layout.blocks.forEach((block, origin) => {
      if (!removedGroup(origin)) return;
      const by = innerIndent(origin).length - lines[block.open]!.indent.length;
      for (let i = block.open + 1; i < block.close; i += 1) outdent[i]! += Math.max(0, by);
    });
    const shift = (text: string, by: number) => {
      if (!by || text.trim() === '') return text;
      return ' '.repeat(Math.max(0, indentOf(text).length - by)) + text.trimStart();
    };
    const blockOfClose = new Map(layout.blocks.map((b, origin) => [b.close, origin]));
    lines.forEach((line, i) => {
      out.push(...written(`before:${i}`, line.indent).map((t) => shift(t, outdent[i]!)));
      const closing = blockOfClose.get(i);
      if (closing !== undefined) {
        out.push(...written(`close:${i}`, innerIndent(closing)).map((t) => shift(t, outdent[i]!)));
      }
      const texts = lineText(i);
      if (texts) out.push(...texts.map((t) => shift(t, outdent[i]!)));
      const opening = layout.blocks.findIndex((b) => b.open === i);
      if (opening >= 0) {
        out.push(...written(`open:${i}`, innerIndent(opening)).map((t) => shift(t, outdent[i]!)));
      }
      if (i === lastTop) out.push(...written('top', topIndent));
      if (i === colourAt) out.push(...colourLines);
      if (i === lastTop && colourAt < 0) out.push(...colourLines);
    });
    if (lastTop < 0) {
      out.push(...written('top', topIndent));
      if (colourAt < 0) out.push(...colourLines);
    }
    for (const extra of newExtras) for (const line of extra.split('\n')) out.push(topIndent + line);
    let first = layout.firstLine;
    if (chart.keyword !== was.keyword || chart.direction !== was.direction) {
      first = `${indentOf(first)}${chart.keyword} ${directionName(chart.direction)}`;
    }
    return [...chart.head, first, ...out, ...layout.tail].join(layout.eol);
  };

  // Read the result back, and add what it still lacks: a box's declaration, its name in its
  // group, its colour, or a group's own id (when Mermaid would number it differently now).
  let code = render();
  for (let round = 0; round < 3; round += 1) {
    const again = readFlowchartCode(code);
    if (!again.ok) break;
    const read = new Map(again.model.nodes.map((n) => [n.id, n]));
    const readGroups = new Set(again.model.groups.map((g) => g.id));
    let fixed = false;
    for (const node of chart.nodes) {
      const got = read.get(node.id);
      if (!got || got.label !== node.label || got.shape !== node.shape) {
        add(placeOf(node.group), { text: nodeSyntax({ ...node, classes: [] }) });
        fixed = true;
      } else if (got.group !== node.group && node.group !== null) {
        add(placeOf(node.group), { text: node.id });
        fixed = true;
      }
      if (got && got.colour !== node.colour && node.colour) {
        addColour(node);
        fixed = true;
      }
    }
    for (const [origin, group] of groupNow) {
      if (!readGroups.has(group.id) && !explicitLines.has(origin)) {
        explicitLines.set(origin, groupLine(group));
        fixed = true;
      }
    }
    if (!fixed) break;
    code = render();
  }
  return code;
}

function writeFlowchart(chart: Flowchart, layout: FlowLayout | null): string {
  return layout ? writeMinimal(chart, layout) : writeTidy(chart);
}

/** What a flowchart means, without how its code is written (for comparing two of them). */
export const flowchartMeaning = (c: Flowchart) => ({
  head: c.head,
  keyword: c.keyword,
  direction: c.direction,
  nodes: [...c.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => [n.id, n.label, n.shape, n.colour, [...n.classes].sort(), n.group]),
  // An invisible link (`~~~`) has no heads to write.
  edges: c.edges.map((e) =>
    e.line === 'invisible'
      ? [e.from, e.to, e.label, e.line, 'none', 'none', e.extra]
      : [e.from, e.to, e.label, e.line, e.start, e.end, e.extra],
  ),
  groups: [...c.groups]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((g) => [g.id, g.label, g.parent, g.direction]),
});

const sameFlowchart = (a: Flowchart, b: Flowchart) =>
  sameJson(flowchartMeaning(a), flowchartMeaning(b)) && sameBag(a.extras, b.extras);

/** Writes a flowchart as Mermaid code. */
export function printFlowchart(chart: Flowchart): string {
  return printChecked(chart, readFlowchartCode, writeFlowchart, sameFlowchart);
}
