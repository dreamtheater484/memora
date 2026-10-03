import { describe, expect, it } from 'vitest';
import {
  colourDefinition,
  detectDiagram,
  diagramMeaning,
  diagramName,
  diagramSummary,
  diagramText,
  parseDiagram,
  parseFlowchart,
  parseGantt,
  parseMindmap,
  parsePie,
  parseSequence,
  parseTimeline,
  printDiagram,
  printFlowchart,
  printGantt,
  printMindmap,
  printPie,
  printTimeline,
  type DiagramModel,
} from './index';

const model = <T>(result: { ok: true; model: T } | { ok: false; reason: string }): T => {
  if (!result.ok) throw new Error(result.reason);
  return result.model;
};

/** A model's data without where it came from (`source` and `origin`). */
const bare = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (key, v: unknown) =>
      key === 'origin' || key === 'source' ? undefined : v,
    ),
  );

/** Printing then reading again gives the same model. */
function roundTrips(code: string) {
  const first = model(parseDiagram(code));
  const printed = printDiagram(first);
  const again = model(parseDiagram(printed));
  expect(diagramMeaning(again)).toEqual(diagramMeaning(first));
  return { first, printed };
}

describe('detectDiagram', () => {
  it('reads the type from the first line, past front matter and directives', () => {
    expect(detectDiagram('graph TD\n A-->B')).toBe('flowchart');
    expect(detectDiagram('---\ntitle: Hi\n---\n%%{init: {}}%%\n\nflowchart LR')).toBe('flowchart');
    expect(detectDiagram('sequenceDiagram')).toBe('sequence');
    expect(detectDiagram('mindmap\n  root')).toBe('mindmap');
    expect(detectDiagram('timeline')).toBe('timeline');
    expect(detectDiagram('gantt')).toBe('gantt');
    expect(detectDiagram('pie showData')).toBe('pie');
    expect(detectDiagram('classDiagram\n A <|-- B')).toBe('other');
    expect(detectDiagram('  \n%% just a comment')).toBeNull();
  });
});

describe('flowcharts', () => {
  it('reads boxes in every shape, arrows of every kind, chains and & lists', () => {
    const chart = model(
      parseFlowchart(`flowchart LR
  A[Order received] --> B{"Paid?"}
  B -->|yes| C([Ship])
  B -- no --> D((Refund))
  C -.-> E[(Archive)]
  D ==> E
  E --- F[[Sub]] & G{{Hex}}
  F <--> G
  G --o H[/In/] --x I[\\Out\\]
  I ~~~ J>Flag] ---> K[/Trap\\] -. maybe .-> L[\\Alt/]
  M(Round) === N(((Double)))`),
    );
    expect(chart.direction).toBe('LR');
    const shapes = Object.fromEntries(chart.nodes.map((n) => [n.id, n.shape]));
    expect(shapes).toEqual({
      A: 'rect',
      B: 'diamond',
      C: 'stadium',
      D: 'circle',
      E: 'cylinder',
      F: 'subroutine',
      G: 'hexagon',
      H: 'parallelogram',
      I: 'parallelogram-alt',
      J: 'asymmetric',
      K: 'trapezoid',
      L: 'trapezoid-alt',
      M: 'round',
      N: 'double-circle',
    });
    expect(chart.nodes.find((n) => n.id === 'B')!.label).toBe('Paid?');
    const edge = (from: string, to: string) =>
      chart.edges.find((e) => e.from === from && e.to === to)!;
    expect(edge('B', 'C')).toMatchObject({ label: 'yes', line: 'solid', end: 'arrow' });
    expect(edge('B', 'D')).toMatchObject({ label: 'no', line: 'solid', end: 'arrow' });
    expect(edge('C', 'E')).toMatchObject({ line: 'dotted', end: 'arrow', label: '' });
    expect(edge('D', 'E')).toMatchObject({ line: 'thick', end: 'arrow' });
    expect(edge('E', 'F')).toMatchObject({ line: 'solid', end: 'none' });
    expect(edge('E', 'G')).toMatchObject({ line: 'solid', end: 'none' });
    expect(edge('F', 'G')).toMatchObject({ start: 'arrow', end: 'arrow' });
    expect(edge('G', 'H')).toMatchObject({ end: 'circle' });
    expect(edge('H', 'I')).toMatchObject({ end: 'cross' });
    expect(edge('I', 'J')).toMatchObject({ line: 'invisible' });
    expect(edge('J', 'K')).toMatchObject({ extra: 1, end: 'arrow' });
    expect(edge('K', 'L')).toMatchObject({ line: 'dotted', label: 'maybe', end: 'arrow' });
    expect(edge('M', 'N')).toMatchObject({ line: 'thick', end: 'none' });
  });

  it('keeps groups, directions, colours and other statements, where they were', () => {
    const code = `---
title: Shop
---
graph TD
  %% the start
  A --> B
  subgraph shop [Shop floor]
    direction LR
    B
    C:::m-green --> D:::urgent
    subgraph inner
      E
    end
  end
  classDef m-blue fill:#000
  class A,B m-blue
  classDef urgent stroke:red
  style E fill:#f9f
  click A "https://example.com"`;
    const chart = model(parseFlowchart(code));
    expect(chart.head).toEqual(['---', 'title: Shop', '---']);
    expect(chart.keyword).toBe('graph');
    expect(bare(chart.groups)).toEqual([
      { id: 'shop', label: 'Shop floor', parent: null, direction: 'LR' },
      { id: 'inner', label: 'inner', parent: 'shop', direction: null },
    ]);
    const node = (id: string) => chart.nodes.find((n) => n.id === id)!;
    expect(node('A')).toMatchObject({ colour: 'blue', group: null });
    expect(node('B')).toMatchObject({ colour: 'blue', group: 'shop' });
    expect(node('C')).toMatchObject({ colour: 'green', group: 'shop' });
    expect(node('D')).toMatchObject({ classes: ['urgent'], group: 'shop' });
    expect(node('E').group).toBe('inner');
    expect(chart.extras).toEqual([
      '%% the start',
      'classDef urgent stroke:red',
      'style E fill:#f9f',
      'click A "https://example.com"',
    ]);
    // Unchanged, it is written back as it was.
    const { printed } = roundTrips(code);
    expect(printed).toBe(code);
    // Without a source, it is written afresh in the tidy layout.
    expect(printFlowchart(bare(chart))).toBe(`---
title: Shop
---
graph TD
    A
    subgraph shop [Shop floor]
        direction LR
        B
        C
        D:::urgent
        subgraph inner
            E
        end
    end
    A --> B
    C --> D
    ${colourDefinition('blue')}
    class A,B m-blue
    ${colourDefinition('green')}
    class C m-green
    %% the start
    classDef urgent stroke:red
    style E fill:#f9f
    click A "https://example.com"`);
  });

  it('puts a box in the innermost group that names it, as Mermaid does', () => {
    const chart = model(
      parseFlowchart('flowchart LR\n subgraph p\n  A --> B\n  subgraph g\n   A\n  end\n end'),
    );
    expect(chart.nodes.find((n) => n.id === 'A')!.group).toBe('g');
    expect(chart.nodes.find((n) => n.id === 'B')!.group).toBe('p');
  });

  it('quotes labels that need it, and reads them back', () => {
    const chart = model(
      parseFlowchart('flowchart LR\n  A["Total (net) #quot;x#quot;"] -->|"a|b"| B'),
    );
    expect(chart.nodes[0]!.label).toBe('Total (net) "x"');
    expect(chart.edges[0]!.label).toBe('a|b');
    chart.nodes[0]!.label = 'Line one\nline two; with "quotes" & more';
    const printed = printFlowchart(chart);
    expect(printed).toContain('A["Line one<br>line two; with #quot;quotes#quot; & more"]');
    expect(model(parseFlowchart(printed)).nodes[0]!.label).toBe(
      'Line one\nline two; with "quotes" & more',
    );
  });

  it('reads statements split by semicolons and a group linked like a box', () => {
    const chart = model(
      parseFlowchart('flowchart TB\n A-->B; B-->C\n subgraph G\n C\n end\n A --> G'),
    );
    expect(chart.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['A>B', 'B>C', 'A>G']);
    expect(chart.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    // A semicolon in a label, or in an entity code, doesn't end a statement.
    const labels = model(parseFlowchart('flowchart LR\n A[a;b] --> B>x#59;y] -->|c;d| C'));
    expect(labels.nodes.map((n) => n.label)).toEqual(['a;b', 'x;y', 'C']);
    expect(labels.edges[1]!.label).toBe('c;d');
  });

  it('refuses what it can’t read faithfully, saying where', () => {
    expect(parseFlowchart('flowchart LR\n  A@{ shape: rect } --> B')).toMatchObject({
      ok: false,
      line: 2,
    });
    expect(parseFlowchart('flowchart LR\n  A e1@--> B')).toMatchObject({ ok: false });
    expect(parseFlowchart('flowchart LR\n  A[open --> B')).toMatchObject({ ok: false });
    expect(parseFlowchart('flowchart LR\n subgraph X\n A')).toMatchObject({ ok: false });
    expect(parseFlowchart('flowchart XY')).toMatchObject({ ok: false, line: 1 });
  });
});

describe('sequence diagrams', () => {
  const code = `sequenceDiagram
    title Signing in
    autonumber
    actor U as User
    participant S as Server
    U->>+S: Sign in#59; please
    S-->>-U: Token #35;1
    Note over U,S: Session starts
    loop Every minute
        U-)S: Ping
        alt Fresh
            S-->>U: Pong
        else Stale
            S--xU: Gone
        end
    end
    activate U
    Note right of DB: implicit
    %% kept`;

  it('reads participants, messages, notes, blocks and kept statements', () => {
    const diagram = model(parseSequence(code));
    expect(diagram.title).toBe('Signing in');
    expect(diagram.autonumber).toBe(true);
    expect(bare(diagram.participants)).toEqual([
      { id: 'U', label: 'User', kind: 'actor' },
      { id: 'S', label: 'Server', kind: 'participant' },
      { id: 'DB', label: 'DB', kind: 'participant' },
    ]);
    expect(bare(diagram.steps[0])).toEqual({
      kind: 'message',
      from: 'U',
      to: 'S',
      arrow: '->>',
      text: 'Sign in; please',
      activation: '+',
    });
    expect(diagram.steps[1]).toMatchObject({ text: 'Token #1', activation: '-', arrow: '-->>' });
    expect(bare(diagram.steps[2])).toEqual({
      kind: 'note',
      side: 'over',
      of: ['U', 'S'],
      text: 'Session starts',
    });
    const loop = diagram.steps[3]!;
    expect(loop).toMatchObject({ kind: 'block', block: 'loop' });
    if (loop.kind !== 'block') throw new Error();
    expect(loop.branches[0]!.steps[1]).toMatchObject({
      block: 'alt',
      branches: [{ text: 'Fresh' }, { text: 'Stale' }],
    });
    expect(bare(diagram.steps.slice(4))).toEqual([
      { kind: 'raw', text: 'activate U' },
      { kind: 'note', side: 'right of', of: ['DB'], text: 'implicit' },
      { kind: 'raw', text: '%% kept' },
    ]);
  });

  it('writes it back as it reads; changed text gets its entities', () => {
    const { printed, first } = roundTrips(code);
    expect(printed).toBe(code);
    const step = first.type === 'sequence' ? first.steps[1]! : null;
    if (step?.kind !== 'message') throw new Error();
    step.text = 'Token; #2';
    expect(printDiagram(first)).toContain('    S-->>-U: Token#59; #35;2\n');
  });

  it('reads `participant A as` (with nothing after) as an empty name', () => {
    const diagram = model(parseSequence('sequenceDiagram\n participant A as\n participant as'));
    expect(diagram.participants.map((p) => [p.id, p.label])).toEqual([
      ['A', ''],
      ['as', 'as'],
    ]);
  });

  it('refuses stray branches and unclosed blocks', () => {
    expect(parseSequence('sequenceDiagram\n A->>B: x\n else nope')).toMatchObject({ ok: false });
    expect(parseSequence('sequenceDiagram\n loop x\n A->>B: y')).toMatchObject({ ok: false });
  });
});

describe('mind maps', () => {
  it('reads the outline with shapes, icons and classes', () => {
    const map = model(
      parseMindmap(`mindmap
  root((Project))
    Goals
      id1[Fast]
        ::icon(fa fa-bolt)
      Simple
    b))Risks((
      c)Scope(
      {{Time}}
      (Money)`),
    );
    expect(map.root).toMatchObject({ label: 'Project', shape: 'circle', id: 'root' });
    expect(map.root.children.map((c) => [c.label, c.shape])).toEqual([
      ['Goals', 'default'],
      ['Risks', 'bang'],
    ]);
    expect(map.root.children[0]!.children[0]).toMatchObject({
      label: 'Fast',
      shape: 'square',
      decorations: ['::icon(fa fa-bolt)'],
    });
    expect(map.root.children[1]!.children.map((c) => [c.label, c.shape])).toEqual([
      ['Scope', 'cloud'],
      ['Time', 'hexagon'],
      ['Money', 'rounded'],
    ]);
  });

  it('keeps brackets and quotes as typed: entities in plain topics, quotes in shapes', () => {
    const map = model(parseMindmap('mindmap\n  root\n    Plain\n    t1[Old]'));
    map.root.children[0]!.label = 'Fast (v2) #1';
    map.root.children.push({
      label: 'Say "hi"\nthere',
      shape: 'hexagon',
      id: null,
      decorations: [],
      children: [],
    });
    const printed = printMindmap(map);
    expect(printed).toBe(
      'mindmap\n  root\n    Fast #40;v2#41; #1\n    t1[Old]\n    {{"Say #quot;hi#quot;<br>there"}}',
    );
    expect(model(parseMindmap(printed)).root.children.map((c) => [c.label, c.shape])).toEqual([
      ['Fast (v2) #1', 'default'],
      ['Old', 'square'],
      ['Say "hi"\nthere', 'hexagon'],
    ]);
  });

  it('reads a plain topic as written, quotes and all', () => {
    const map = model(parseMindmap('mindmap\n  root\n    "quoted"\n    a #quot;b#quot;'));
    expect(map.root.children.map((c) => c.label)).toEqual(['"quoted"', 'a "b"']);
  });

  it('has one central topic', () => {
    expect(parseMindmap('mindmap\n  a\n  b')).toMatchObject({ ok: false });
  });
});

describe('timelines, Gantt charts and pie charts', () => {
  it('reads and writes a timeline', () => {
    const timeline = model(
      parseTimeline(`timeline
    title Launch
    2025 : Idea
    section Q1
      Jan : Plan : Hire
          : Budget
      Feb : Build at 10:30
    section Q2
      Apr : Ship`),
    );
    expect(timeline.title).toBe('Launch');
    expect(bare(timeline.sections)).toEqual([
      { label: null, periods: [{ label: '2025', events: ['Idea'] }] },
      {
        label: 'Q1',
        periods: [
          { label: 'Jan', events: ['Plan', 'Hire', 'Budget'] },
          { label: 'Feb', events: ['Build at 10:30'] },
        ],
      },
      { label: 'Q2', periods: [{ label: 'Apr', events: ['Ship'] }] },
    ]);
    timeline.sections[2]!.periods[0]!.events.push('Party: at 8');
    const printed = printTimeline(timeline);
    expect(printed).toContain('      Apr : Ship : Party#58; at 8');
    expect(diagramMeaning(model(parseTimeline(printed)))).toEqual(diagramMeaning(timeline));
  });

  it('keeps a direction on the first line', () => {
    const timeline = model(parseTimeline('timeline TD\n  2020 : a'));
    expect(timeline.extras).toEqual([]);
    timeline.sections[0]!.periods[0]!.label = '2021';
    expect(printTimeline(timeline)).toBe('timeline TD\n  2021 : a');
  });

  it('reads and writes a Gantt chart, giving a task with an id a start', () => {
    const gantt = model(
      parseGantt(`gantt
    title Plan
    dateFormat YYYY-MM-DD
    axisFormat %d %b
    excludes weekends
    section Build
    Design :done, d1, 2026-01-01, 5d
    Code :active, crit, c1, after d1, 10d
    Test :3d
    Launch :milestone, after c1, 0d
    section Later
    Party :2026-03-01, until c1`),
    );
    expect(gantt).toMatchObject({
      title: 'Plan',
      excludesWeekends: true,
      extras: ['axisFormat %d %b'],
    });
    expect(bare(gantt.sections[0]!.tasks[1])).toEqual({
      name: 'Code',
      tags: ['active', 'crit'],
      id: 'c1',
      start: { kind: 'after', ids: ['d1'] },
      end: { kind: 'duration', value: '10d' },
    });
    expect(gantt.sections[0]!.tasks[2]).toMatchObject({
      id: null,
      start: { kind: 'previous' },
      end: { kind: 'duration', value: '3d' },
    });
    expect(gantt.sections[1]!.tasks[0]!.end).toEqual({ kind: 'until', ids: ['c1'] });
    expect(diagramMeaning(model(parseGantt(printGantt(gantt))))).toEqual(diagramMeaning(gantt));
    // An id needs a start: the task above gets one to start after.
    gantt.sections[0]!.tasks[2]!.id = 't';
    expect(printGantt(gantt)).toContain(
      'Code :active, crit, c1, after d1, 10d\n    Test :t, after c1, 3d',
    );
  });

  it('reads settings whatever they hold, and keeps them', () => {
    const gantt = model(
      parseGantt('gantt\n  dateFormat HH:mm\n  axisFormat %H:%M\n  Task : 17:49, 2m'),
    );
    expect(gantt.extras).toEqual(['axisFormat %H:%M']);
    expect(gantt.sections[0]!.tasks.map((t) => t.name)).toEqual(['Task']);
  });

  it('reads and writes a pie chart', () => {
    const pie = model(parsePie('pie title Budget\n  "Rent" : 40\n  "Food #quot;in#quot;" : 25.5'));
    expect(pie).toMatchObject({
      title: 'Budget',
      showData: false,
      slices: [
        { label: 'Rent', value: 40 },
        { label: 'Food "in"', value: 25.5 },
      ],
    });
    pie.showData = true;
    expect(printPie(pie)).toBe(
      'pie showData title Budget\n  "Rent" : 40\n  "Food #quot;in#quot;" : 25.5',
    );
    expect(parsePie('pie\n  Rent : 40')).toMatchObject({ ok: false, line: 2 });
  });
});

describe('diagramText', () => {
  it('gives the words of every kind of diagram', () => {
    expect(diagramText('flowchart LR\n A[Order received] -->|yes| B{Paid?}')).toBe(
      'Order received · Paid? · yes',
    );
    expect(diagramText('sequenceDiagram\n A->>B: Hello')).toBe('A · B · Hello');
    expect(diagramText('mindmap\n  root((Plan))\n    Goals')).toBe('Plan · Goals');
    expect(diagramText('pie title Spend\n "Rent" : 1')).toBe('Spend · Rent');
    expect(diagramText('classDiagram\n class Animal["An animal"]\n Animal : +int age')).toBe(
      'An animal · +int age',
    );
  });

  it('describes a diagram for screen readers', () => {
    expect(diagramSummary('flowchart LR\n A[Start] --> B[End]')).toBe('Flowchart: Start, End');
    expect(diagramSummary('gantt')).toBe('Gantt chart');
  });

  it('names every kind of diagram, with its words', () => {
    const cases: [string, string][] = [
      ['classDiagram\n    class Animal\n    Animal <|-- Dog', 'Class diagram: Animal, Dog'],
      ['classDiagram-v2\n    A --> B', 'Class diagram: A, B'],
      [
        'stateDiagram-v2\n    [*] --> Draft\n    Draft --> Review : submit\n    Review --> [*]',
        'State diagram: Draft, Review, submit',
      ],
      [
        'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    PRODUCT ||--o{ LINE : "is in"',
        'Entity relationship diagram: CUSTOMER, ORDER, places, PRODUCT, LINE, is in',
      ],
      [
        'journey\n    title Making tea\n    section Kitchen\n      Boil water: 5: Me',
        'User journey: Making tea, Kitchen, Boil water, Me',
      ],
      [
        'quadrantChart\n    title Ideas\n    x-axis Low --> High\n    Newsletter: [0.3, 0.6]',
        'Quadrant chart: Ideas, Low, High, Newsletter',
      ],
      ['gitGraph\n    commit\n    branch feature\n    commit', 'Git graph: feature'],
      ['xychart-beta\n    title "Sales"\n    bar [1, 2]', 'XY chart: Sales'],
      ['sankey-beta\n    A,B,10', 'Sankey diagram'],
      ['block-beta\n    a b', 'Block diagram'],
      ['architecture-beta\n    service db(database)[Database]', 'Architecture diagram: Database'],
      ['packet-beta\n    0-15: "Source Port"', 'Packet diagram: Source Port'],
      [
        'requirementDiagram\n    requirement test_req {\n    id: 1\n    }',
        'Requirement diagram: test_req',
      ],
      ['C4Context\n    Person(customer, "Customer")', 'C4 context diagram: Customer'],
      ['C4Container\n    title Shop', 'C4 container diagram'],
      ['kanban\n  Todo', 'Kanban board'],
      ['somethingNew\n  x', 'Diagram'],
    ];
    for (const [code, summary] of cases) expect(diagramSummary(code), code).toBe(summary);
    expect(diagramName('timeline\n  2020 : a')).toBe('Timeline');
    expect(diagramName('stateDiagram\n  A --> B')).toBe('State diagram');
  });
});

it('prints every model type it reads', () => {
  const samples = [
    'flowchart LR\n A --> B',
    'sequenceDiagram\n A->>B: Hi',
    'mindmap\n  root\n    a',
    'timeline\n 2020 : x',
    'gantt\n Task :2026-01-01, 1d',
    'pie\n "a" : 1',
  ];
  for (const sample of samples) {
    const parsed: DiagramModel = model(parseDiagram(sample));
    expect(printDiagram(parsed)).toBe(sample);
    expect(model(parseDiagram(printDiagram(parsed)))).toEqual(parsed);
  }
});
