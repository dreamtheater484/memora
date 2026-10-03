import { describe, expect, it } from 'vitest';
import {
  colourDefinition,
  diagramMeaning,
  parseDiagram,
  printDiagram,
  type DiagramModel,
  type Flowchart,
  type Gantt,
  type Mindmap,
  type Pie,
  type SequenceDiagram,
  type Timeline,
} from './index';
import { common } from './source';
import { DIAGRAM_CORPUS, TEXT_SAMPLES, clone, textFields } from './testCorpus';

/*
 * Printing with as few changes as possible (§3.4): unchanged diagrams come back byte for
 * byte, an edit changes only the lines of what changed, and every text a user can type,
 * empty included, reads back the same.
 */

const read = (code: string): DiagramModel => {
  const result = parseDiagram(code);
  if (!result.ok) throw new Error(`${result.reason} (line ${result.line})`);
  return result.model;
};

/** Edits a copy of a diagram's model and prints it. */
function edit<M extends DiagramModel>(code: string, change: (m: M) => void) {
  const m = clone(read(code)) as M;
  change(m);
  const printed = printDiagram(m);
  // What is written means what the model says.
  expect(diagramMeaning(read(printed))).toEqual(diagramMeaning(m));
  return printed;
}

/** The lines an edit removed and added (a longest common subsequence of lines). */
function diff(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  const pairs = common(a, b);
  const keptA = new Set(pairs.map(([i]) => i));
  const keptB = new Set(pairs.map(([, j]) => j));
  return { removed: a.filter((_, i) => !keptA.has(i)), added: b.filter((_, j) => !keptB.has(j)) };
}

const expectDiff = (before: string, after: string, removed: string[], added: string[]) =>
  expect(diff(before, after)).toEqual({ removed, added });

describe('unchanged diagrams', () => {
  it.each(DIAGRAM_CORPUS.map((d) => [d.name, d.code]))('%s comes back byte for byte', (_, code) => {
    expect(printDiagram(read(code))).toBe(code);
  });

  it('keeps where it came from through copies', () => {
    for (const { code } of DIAGRAM_CORPUS) {
      const m = read(code);
      expect(printDiagram(clone(m))).toBe(code);
      expect(printDiagram(JSON.parse(JSON.stringify(m)) as DiagramModel)).toBe(code);
      expect(printDiagram({ ...m } as DiagramModel)).toBe(code);
    }
    // The editor's operations copy the model and assign changes to its items.
    const flow = read(FLOW) as Flowchart;
    const copy = clone(flow);
    Object.assign(copy.nodes[1]!, { label: 'Paid?' });
    copy.nodes = copy.nodes.filter(() => true);
    expect(printDiagram(copy)).toBe(FLOW);
  });

  it('writes models built from scratch in the tidy layout', () => {
    const pie: Pie = {
      type: 'pie',
      head: [],
      title: 'Spend',
      showData: true,
      slices: [{ label: 'Rent', value: 40 }],
      extras: [],
    };
    expect(printDiagram(pie)).toBe('pie showData\n    title Spend\n    "Rent" : 40');
  });

  it('treats an item copied with its origin as a new one', () => {
    const printed = edit<Flowchart>(FLOW, (m) => {
      m.nodes.push({ ...m.nodes[0]!, id: 'n9', label: 'Copy' });
    });
    expectDiff(FLOW, printed, [], ['    n9[Copy]']);
  });
});

const FLOW = `flowchart TD
    n1["Order received"]
    n2{"Paid?"}
    n3["Ship it"]
    n4["Send a reminder"]
    n1 --> n2
    n2 -->|"Yes"| n3
    n2 -->|"No"| n4
    n4 -.-> n2
    ${colourDefinition('yellow')}
    class n2 m-yellow`;

const CHAIN = `flowchart LR
  A[Order received] --> B{Paid?} --> C(Ship)
  %% a comment
  B -- no --> D
  style A fill:#f9f`;

const TEAMS = `flowchart LR
    subgraph g1 ["Sales"]
        n1["Quote"]
        n2["Order"]
    end
    subgraph g2 ["Warehouse"]
        n3["Pick"]
        n4["Pack"]
    end
    n1 --> n2
    n2 --> n3
    n3 --> n4`;

describe('flowcharts change only what changed', () => {
  const node = (m: Flowchart, id: string) => m.nodes.find((n) => n.id === id)!;
  const edgeOf = (m: Flowchart, from: string, to: string) =>
    m.edges.find((e) => e.from === from && e.to === to)!;

  it('a label', () => {
    const printed = edit<Flowchart>(FLOW, (m) => (node(m, 'n2').label = 'Paid now?'));
    expectDiff(FLOW, printed, ['    n2{"Paid?"}'], ['    n2{"Paid now?"}']);
  });

  it('a colour: added, changed, removed', () => {
    const blue = edit<Flowchart>(FLOW, (m) => (node(m, 'n1').colour = 'blue'));
    expectDiff(FLOW, blue, [], [`    ${colourDefinition('blue')}`, '    class n1 m-blue']);
    const green = edit<Flowchart>(FLOW, (m) => (node(m, 'n2').colour = 'green'));
    expectDiff(
      FLOW,
      green,
      [`    ${colourDefinition('yellow')}`, '    class n2 m-yellow'],
      [`    ${colourDefinition('green')}`, '    class n2 m-green'],
    );
    const none = edit<Flowchart>(FLOW, (m) => (node(m, 'n2').colour = null));
    expectDiff(FLOW, none, [`    ${colourDefinition('yellow')}`, '    class n2 m-yellow'], []);
    const joined = edit<Flowchart>(FLOW, (m) => (node(m, 'n4').colour = 'yellow'));
    expectDiff(FLOW, joined, ['    class n2 m-yellow'], ['    class n2,n4 m-yellow']);
  });

  it('a shape', () => {
    const printed = edit<Flowchart>(FLOW, (m) => (node(m, 'n3').shape = 'round'));
    expectDiff(FLOW, printed, ['    n3["Ship it"]'], ['    n3("Ship it")']);
  });

  it('an arrow’s style and label', () => {
    const thick = edit<Flowchart>(FLOW, (m) => (edgeOf(m, 'n4', 'n2').line = 'thick'));
    expectDiff(FLOW, thick, ['    n4 -.-> n2'], ['    n4 ==> n2']);
    const label = edit<Flowchart>(FLOW, (m) => (edgeOf(m, 'n2', 'n3').label = 'Yes!'));
    expectDiff(FLOW, label, ['    n2 -->|"Yes"| n3'], ['    n2 -->|"Yes!"| n3']);
    const none = edit<Flowchart>(FLOW, (m) => (edgeOf(m, 'n2', 'n3').label = ''));
    expectDiff(FLOW, none, ['    n2 -->|"Yes"| n3'], ['    n2 --> n3']);
  });

  it('a box and an arrow added at the end of the boxes and arrows', () => {
    const printed = edit<Flowchart>(FLOW, (m) => {
      m.nodes.push({
        id: 'n5',
        label: 'New box',
        shape: 'rect',
        colour: null,
        classes: [],
        group: null,
      });
      m.edges.push({
        from: 'n3',
        to: 'n5',
        label: '',
        line: 'solid',
        start: 'none',
        end: 'arrow',
        extra: 0,
      });
    });
    expectDiff(FLOW, printed, [], ['    n5[New box]', '    n3 --> n5']);
    expect(printed).toContain('    n4 -.-> n2\n    n5[New box]\n    n3 --> n5\n    classDef');
  });

  it('a box removed with its arrows, an arrow removed', () => {
    const box = edit<Flowchart>(FLOW, (m) => {
      m.nodes = m.nodes.filter((n) => n.id !== 'n4');
      m.edges = m.edges.filter((e) => e.from !== 'n4' && e.to !== 'n4');
    });
    expectDiff(
      FLOW,
      box,
      ['    n4["Send a reminder"]', '    n2 -->|"No"| n4', '    n4 -.-> n2'],
      [],
    );
    const arrow = edit<Flowchart>(FLOW, (m) => m.edges.splice(1, 1));
    expectDiff(FLOW, arrow, ['    n2 -->|"Yes"| n3'], []);
  });

  it('boxes put in a new group, and a group taken away', () => {
    const grouped = edit<Flowchart>(FLOW, (m) => {
      m.groups.push({ id: 'g1', label: 'Group', parent: null, direction: null });
      node(m, 'n1').group = 'g1';
      node(m, 'n2').group = 'g1';
    });
    expectDiff(
      FLOW,
      grouped,
      [],
      ['    subgraph g1 [Group]', '        n1', '        n2', '    end'],
    );
    const ungrouped = edit<Flowchart>(TEAMS, (m) => {
      m.groups = m.groups.filter((g) => g.id !== 'g1');
      for (const n of m.nodes) if (n.group === 'g1') n.group = null;
    });
    expectDiff(
      TEAMS,
      ungrouped,
      ['    subgraph g1 ["Sales"]', '        n1["Quote"]', '        n2["Order"]', '    end'],
      ['    n1["Quote"]', '    n2["Order"]'],
    );
    const inGroup = edit<Flowchart>(TEAMS, (m) => {
      m.nodes.push({
        id: 'n5',
        label: 'Ship',
        shape: 'rect',
        colour: null,
        classes: [],
        group: 'g2',
      });
      m.groups[1]!.direction = 'TB';
    });
    expectDiff(TEAMS, inGroup, [], ['        direction TB', '        n5[Ship]']);
    expect(inGroup).toContain('        n4["Pack"]\n        n5[Ship]\n    end');
  });

  it('the direction', () => {
    const printed = edit<Flowchart>(FLOW, (m) => (m.direction = 'LR'));
    expectDiff(FLOW, printed, ['flowchart TD'], ['flowchart LR']);
  });

  it('chains stay chains, with comments and styles where they were', () => {
    const label = edit<Flowchart>(CHAIN, (m) => (node(m, 'B').label = 'Paid already?'));
    expectDiff(
      CHAIN,
      label,
      ['  A[Order received] --> B{Paid?} --> C(Ship)'],
      ['  A[Order received] --> B{Paid already?} --> C(Ship)'],
    );
    // A box named without a label gets one where it is.
    const named = edit<Flowchart>(CHAIN, (m) => (node(m, 'D').label = 'Refund'));
    expectDiff(CHAIN, named, ['  B -- no --> D'], ['  B -- no --> D[Refund]']);
    // A label in the middle of an arrow stays there.
    const middle = edit<Flowchart>(CHAIN, (m) => (edgeOf(m, 'B', 'D').label = 'not yet'));
    expectDiff(CHAIN, middle, ['  B -- no --> D'], ['  B -- not yet --> D']);
    // An arrow taken out of a chain splits it there.
    const split = edit<Flowchart>(CHAIN, (m) => m.edges.splice(0, 1));
    expectDiff(
      CHAIN,
      split,
      ['  A[Order received] --> B{Paid?} --> C(Ship)'],
      ['  A[Order received]', '  B{Paid?} --> C(Ship)'],
    );
  });
});

const MIND = `mindmap
  root(("Big idea"))
    Why
      For whom
      What it solves
    How
      First step
      Tools
    Risks`;

describe('mind maps change only what changed', () => {
  const topic = (m: Mindmap, ...path: number[]) => path.reduce((t, i) => t.children[i]!, m.root);

  it('a label, a shape', () => {
    const label = edit<Mindmap>(MIND, (m) => (topic(m, 0).label = 'Why not'));
    expectDiff(MIND, label, ['    Why'], ['    Why not']);
    const shape = edit<Mindmap>(MIND, (m) => (topic(m, 2).shape = 'square'));
    expectDiff(MIND, shape, ['    Risks'], ['    [Risks]']);
    const quotes = edit<Mindmap>(MIND, (m) => (topic(m).label = 'Big "idea"'));
    expectDiff(MIND, quotes, ['  root(("Big idea"))'], ['  root(("Big #quot;idea#quot;"))']);
  });

  it('topics added, removed and moved', () => {
    const added = edit<Mindmap>(MIND, (m) =>
      topic(m, 1).children.push({
        label: 'New topic',
        shape: 'default',
        id: null,
        decorations: [],
        children: [],
      }),
    );
    expectDiff(MIND, added, [], ['      New topic']);
    expect(added).toContain('      Tools\n      New topic\n    Risks');
    const removed = edit<Mindmap>(MIND, (m) => topic(m, 0).children.splice(0, 1));
    expectDiff(MIND, removed, ['      For whom'], []);
    const up = edit<Mindmap>(MIND, (m) =>
      m.root.children.unshift(m.root.children.splice(1, 1)[0]!),
    );
    expect(up).toBe(`mindmap
  root(("Big idea"))
    How
      First step
      Tools
    Why
      For whom
      What it solves
    Risks`);
    const indented = edit<Mindmap>(MIND, (m) => topic(m, 1).children.push(m.root.children.pop()!));
    expectDiff(MIND, indented, ['    Risks'], ['      Risks']);
    const outdented = edit<Mindmap>(MIND, (m) => {
      const tools = topic(m, 1).children.pop()!;
      m.root.children.splice(2, 0, tools);
    });
    expectDiff(MIND, outdented, ['      Tools'], ['    Tools']);
  });
});

const SEQ = `sequenceDiagram
    autonumber
    actor U as User
    participant W as Website
    U->>W: Name and password
    alt Correct
        W-->>U: Welcome
    else Wrong
        W-->>U: Try again
    end`;

describe('sequence diagrams change only what changed', () => {
  it('a message, a participant', () => {
    const message = edit<SequenceDiagram>(SEQ, (m) => {
      const step = m.steps[0]!;
      if (step.kind === 'message') step.text = 'Name, password; code';
    });
    expectDiff(
      SEQ,
      message,
      ['    U->>W: Name and password'],
      ['    U->>W: Name, password#59; code'],
    );
    const arrow = edit<SequenceDiagram>(SEQ, (m) => {
      const step = m.steps[0]!;
      if (step.kind === 'message') step.arrow = '-)';
    });
    expectDiff(SEQ, arrow, ['    U->>W: Name and password'], ['    U-)W: Name and password']);
    const person = edit<SequenceDiagram>(SEQ, (m) => (m.participants[0]!.label = 'Customer'));
    expectDiff(SEQ, person, ['    actor U as User'], ['    actor U as Customer']);
  });

  it('steps added, moved, and a block removed (its steps stay)', () => {
    const added = edit<SequenceDiagram>(SEQ, (m) => {
      const block = m.steps[1]!;
      if (block.kind === 'block') {
        block.branches[1]!.steps.push({ kind: 'note', side: 'over', of: ['U'], text: 'Note' });
      }
    });
    expectDiff(SEQ, added, [], ['        Note over U: Note']);
    expect(added).toContain('        W-->>U: Try again\n        Note over U: Note\n    end');
    const moved = edit<SequenceDiagram>(SEQ, (m) => m.steps.push(m.steps.shift()!));
    expectDiff(SEQ, moved, ['    U->>W: Name and password'], ['    U->>W: Name and password']);
    expect(moved.endsWith('    end\n    U->>W: Name and password')).toBe(true);
    const unblocked = edit<SequenceDiagram>(SEQ, (m) => {
      const block = m.steps[1]!;
      if (block.kind === 'block') m.steps.splice(1, 1, ...block.branches.flatMap((b) => b.steps));
    });
    expectDiff(
      SEQ,
      unblocked,
      [
        '    alt Correct',
        '        W-->>U: Welcome',
        '    else Wrong',
        '        W-->>U: Try again',
        '    end',
      ],
      ['    W-->>U: Welcome', '    W-->>U: Try again'],
    );
  });

  it('numbering, a title, participants reordered', () => {
    const off = edit<SequenceDiagram>(SEQ, (m) => (m.autonumber = false));
    expectDiff(SEQ, off, ['    autonumber'], []);
    const title = edit<SequenceDiagram>(SEQ, (m) => (m.title = 'Signing in'));
    expectDiff(SEQ, title, [], ['    title Signing in']);
    const swapped = edit<SequenceDiagram>(SEQ, (m) => m.participants.reverse());
    expectDiff(SEQ, swapped, ['    actor U as User'], ['    actor U as User']);
    expect(swapped).toContain('    participant W as Website\n    actor U as User\n');
  });
});

const TIMELINE = `timeline
    title Project milestones
    section Spring
        March : Kick-off
        April : First design : Feedback
    section Summer
        June : Launch`;

describe('timelines change only what changed', () => {
  it('events changed and added', () => {
    const changed = edit<Timeline>(
      TIMELINE,
      (m) => (m.sections[0]!.periods[1]!.events[1] = 'Notes'),
    );
    expectDiff(
      TIMELINE,
      changed,
      ['        April : First design : Feedback'],
      ['        April : First design : Notes'],
    );
    const added = edit<Timeline>(TIMELINE, (m) => m.sections[0]!.periods[0]!.events.push('Event'));
    expectDiff(TIMELINE, added, ['        March : Kick-off'], ['        March : Kick-off : Event']);
  });

  it('periods added and moved, a section removed', () => {
    const added = edit<Timeline>(TIMELINE, (m) =>
      m.sections[1]!.periods.push({ label: 'When', events: ['What happens'] }),
    );
    expectDiff(TIMELINE, added, [], ['        When : What happens']);
    const moved = edit<Timeline>(TIMELINE, (m) =>
      m.sections[1]!.periods.unshift(m.sections[0]!.periods.pop()!),
    );
    expect(moved).toBe(`timeline
    title Project milestones
    section Spring
        March : Kick-off
    section Summer
        April : First design : Feedback
        June : Launch`);
    const removed = edit<Timeline>(TIMELINE, (m) => m.sections.splice(0, 1));
    expectDiff(
      TIMELINE,
      removed,
      ['    section Spring', '        March : Kick-off', '        April : First design : Feedback'],
      [],
    );
  });
});

const GANTT = `gantt
    title Small project
    dateFormat YYYY-MM-DD
    section Plan
    Research :done, t1, 2026-01-05, 5d
    Design :active, t2, after t1, 7d
    section Build
    Build it :t3, after t2, 10d
    Launch :milestone, after t3, 0d`;

describe('Gantt charts change only what changed', () => {
  const task = (m: Gantt, s: number, t: number) => m.sections[s]!.tasks[t]!;

  it('a name, a status, a length', () => {
    const name = edit<Gantt>(GANTT, (m) => (task(m, 0, 1).name = 'Drawings'));
    expectDiff(
      GANTT,
      name,
      ['    Design :active, t2, after t1, 7d'],
      ['    Drawings :active, t2, after t1, 7d'],
    );
    const status = edit<Gantt>(GANTT, (m) => (task(m, 0, 0).tags = ['active']));
    expectDiff(
      GANTT,
      status,
      ['    Research :done, t1, 2026-01-05, 5d'],
      ['    Research :active, t1, 2026-01-05, 5d'],
    );
    const length = edit<Gantt>(
      GANTT,
      (m) => (task(m, 1, 0).end = { kind: 'duration', value: '12d' }),
    );
    expectDiff(
      GANTT,
      length,
      ['    Build it :t3, after t2, 10d'],
      ['    Build it :t3, after t2, 12d'],
    );
  });

  it('tasks added and moved, a setting added', () => {
    const added = edit<Gantt>(GANTT, (m) =>
      m.sections[1]!.tasks.push({
        name: 'New task',
        tags: [],
        id: null,
        start: { kind: 'previous' },
        end: { kind: 'duration', value: '3d' },
      }),
    );
    expectDiff(GANTT, added, [], ['    New task :3d']);
    const moved = edit<Gantt>(GANTT, (m) => m.sections[0]!.tasks.reverse());
    expectDiff(
      GANTT,
      moved,
      ['    Research :done, t1, 2026-01-05, 5d'],
      ['    Research :done, t1, 2026-01-05, 5d'],
    );
    expect(moved).toContain('    Design :active, t2, after t1, 7d\n    Research');
    const weekends = edit<Gantt>(GANTT, (m) => (m.excludesWeekends = true));
    expectDiff(GANTT, weekends, [], ['    excludes weekends']);
    expect(weekends).toContain('    dateFormat YYYY-MM-DD\n    excludes weekends\n');
  });
});

const PIE = `pie showData
    title Where the time goes
    "Meetings" : 30
    "Writing" : 45
    "Email" : 25`;

describe('pie charts change only what changed', () => {
  it('a label, a value, slices added, removed and reordered', () => {
    expectDiff(
      PIE,
      edit<Pie>(PIE, (m) => (m.slices[1]!.label = 'Reading')),
      ['    "Writing" : 45'],
      ['    "Reading" : 45'],
    );
    expectDiff(
      PIE,
      edit<Pie>(PIE, (m) => (m.slices[1]!.value = 50)),
      ['    "Writing" : 45'],
      ['    "Writing" : 50'],
    );
    expectDiff(
      PIE,
      edit<Pie>(PIE, (m) => m.slices.push({ label: 'Calls', value: 5 })),
      [],
      ['    "Calls" : 5'],
    );
    expectDiff(
      PIE,
      edit<Pie>(PIE, (m) => m.slices.splice(0, 1)),
      ['    "Meetings" : 30'],
      [],
    );
    const swapped = edit<Pie>(PIE, (m) => m.slices.push(m.slices.splice(1, 1)[0]!));
    expectDiff(PIE, swapped, ['    "Writing" : 45'], ['    "Writing" : 45']);
    expectDiff(
      PIE,
      edit<Pie>(PIE, (m) => (m.showData = false)),
      ['pie showData'],
      ['pie'],
    );
  });
});

describe('every text field', () => {
  // A diagram of each type with every kind of field, and the corpus.
  const all = DIAGRAM_CORPUS.map((d) => d.code);

  it('round-trips empty, with the same structure', () => {
    for (const code of all) {
      const base = read(code);
      for (const field of textFields(base)) {
        const m = clone(base);
        field.set(m, '');
        const again = read(printDiagram(m));
        expect(diagramMeaning(again), `${field.name} in\n${code}`).toEqual(diagramMeaning(m));
        expect(field.get(again), field.name).toBe('');
      }
      // All of them at once.
      const m = clone(base);
      for (const field of textFields(m)) field.set(m, '');
      expect(diagramMeaning(read(printDiagram(m))), code).toEqual(diagramMeaning(m));
    }
  });

  it('round-trips every character a user may type', () => {
    for (const code of all) {
      const base = read(code);
      const fields = textFields(base);
      for (const sample of TEXT_SAMPLES) {
        const m = clone(base);
        for (const field of fields) field.set(m, sample);
        const printed = printDiagram(m);
        const again = read(printed);
        expect(diagramMeaning(again), `${JSON.stringify(sample)} in\n${printed}`).toEqual(
          diagramMeaning(m),
        );
        for (const field of fields) expect(field.get(again), field.name).toBe(field.get(m));
      }
    }
  });

  it('keeps a space typed at the end of a label while the next letter comes', () => {
    let code = 'flowchart LR\n    A[Hello] --> B';
    for (const label of ['Hello ', 'Hello w', 'Hello wo']) {
      const m = read(code) as Flowchart;
      m.nodes[0]!.label = label;
      code = printDiagram(m);
      expect((read(code) as Flowchart).nodes[0]!.label).toBe(label);
    }
    expect(code).toBe('flowchart LR\n    A[Hello wo] --> B');
  });

  it('writes Mermaid’s own empty forms where it has them', () => {
    const seq = edit<SequenceDiagram>(SEQ, (m) => {
      m.participants[0]!.label = '';
      const step = m.steps[0]!;
      if (step.kind === 'message') step.text = '';
      const block = m.steps[1]!;
      if (block.kind === 'block') block.branches[1]!.text = '';
    });
    expect(seq).toContain('    actor U as\n');
    expect(seq).toContain('    U->>W:\n');
    expect(seq).toContain('    else\n');
    expect(edit<Pie>(PIE, (m) => (m.slices[0]!.label = ''))).toContain('    "" : 30');
    expect(edit<Flowchart>(FLOW, (m) => (m.nodes[0]!.label = ''))).toContain('    n1[" "]');
    // Where it has none, a zero-width space stands for the empty text.
    expect(edit<Mindmap>(MIND, (m) => (m.root.children[0]!.label = ''))).toContain('    #8203;\n');
    expect(edit<Gantt>(GANTT, (m) => (m.sections[0]!.tasks[0]!.name = ''))).toContain(
      '    #8203; :done, t1',
    );
  });

  it('keeps entity codes typed as text, and what Mermaid would take for syntax', () => {
    const flow = edit<Flowchart>(FLOW, (m) => (m.nodes[0]!.label = 'Total #35; (net) a|b'));
    expect(flow).toContain('    n1["Total #35;35; (net) a|b"]');
    const mind = edit<Mindmap>(MIND, (m) => (m.root.children[0]!.label = 'Say "hi" (twice)'));
    expect(mind).toContain('    Say "hi" #40;twice#41;\n');
    const gantt = edit<Gantt>(GANTT, (m) => (m.sections[0]!.tasks[0]!.name = 'Plan: phase 1, 2'));
    expect(gantt).toContain('    Plan#58; phase 1, 2 :done');
    const timeline = edit<Timeline>(TIMELINE, (m) => (m.sections[0]!.periods[0]!.label = '10:30'));
    expect(timeline).toContain('        10#58;30 : Kick-off');
    const seq = edit<SequenceDiagram>(SEQ, (m) => (m.participants[1]!.label = 'Web as site'));
    expect(seq).toContain('    participant W as Web as site\n');
  });
});
