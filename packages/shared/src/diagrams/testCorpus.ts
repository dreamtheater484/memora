import type { DiagramModel, SequenceStep } from './index';

/*
 * Diagrams for tests only (not part of the package's API): examples from Mermaid's
 * documentation for the six types the editor models, and code written the ways people write
 * it (two-space indents, chains, comments in odd places, CRLF line ends, front matter).
 * Every one is read by Memora and by Mermaid.
 */

/** The runtime's `structuredClone`, which the editor copies models with (not in this lib). */
export const clone = <T>(value: T): T =>
  (globalThis as unknown as { structuredClone: <V>(v: V) => V }).structuredClone(value);

/** A text field the editor can change, found by its place so it works on copies too. */
export interface TextField {
  name: string;
  get: (model: DiagramModel) => string;
  set: (model: DiagramModel, text: string) => void;
}

/** Every text field of a model: labels, names, titles, messages, notes, conditions… */
export function textFields(model: DiagramModel): TextField[] {
  const fields: TextField[] = [];
  const field = <M extends DiagramModel>(
    name: string,
    get: (m: M) => string,
    set: (m: M, text: string) => void,
  ) =>
    fields.push({
      name,
      get: (m) => get(m as M),
      set: (m, text) => set(m as M, text),
    });
  switch (model.type) {
    case 'flowchart':
      model.nodes.forEach((_, i) =>
        field<typeof model>(
          `box ${i}`,
          (m) => m.nodes[i]!.label,
          (m, t) => (m.nodes[i]!.label = t),
        ),
      );
      model.edges.forEach((_, i) =>
        field<typeof model>(
          `arrow ${i}`,
          (m) => m.edges[i]!.label,
          (m, t) => (m.edges[i]!.label = t),
        ),
      );
      model.groups.forEach((_, i) =>
        field<typeof model>(
          `group ${i}`,
          (m) => m.groups[i]!.label,
          (m, t) => (m.groups[i]!.label = t),
        ),
      );
      break;
    case 'sequence': {
      field<typeof model>(
        'title',
        (m) => m.title ?? '',
        (m, t) => (m.title = t || null),
      );
      model.participants.forEach((_, i) =>
        field<typeof model>(
          `participant ${i}`,
          (m) => m.participants[i]!.label,
          (m, t) => (m.participants[i]!.label = t),
        ),
      );
      const walk = (steps: SequenceStep[], path: number[]) =>
        steps.forEach((step, i) => {
          const at = [...path, i];
          const find = (m: typeof model) => {
            let list = m.steps;
            let found: SequenceStep | undefined;
            for (let k = 0; k < at.length; k += 2) {
              found = list[at[k]!];
              if (k + 1 < at.length && found?.kind === 'block')
                list = found.branches[at[k + 1]!]!.steps;
            }
            return found!;
          };
          if (step.kind === 'message' || step.kind === 'note') {
            field<typeof model>(
              `${step.kind} ${at.join('.')}`,
              (m) => (find(m) as { text: string }).text,
              (m, t) => ((find(m) as { text: string }).text = t),
            );
          }
          if (step.kind === 'block') {
            step.branches.forEach((branch, b) => {
              field<typeof model>(
                `branch ${at.join('.')}/${b}`,
                (m) => (find(m) as typeof step).branches[b]!.text,
                (m, t) => ((find(m) as typeof step).branches[b]!.text = t),
              );
              walk(branch.steps, [...at, b]);
            });
          }
        });
      walk(model.steps, []);
      break;
    }
    case 'mindmap': {
      const walk = (path: number[], children: { children: unknown[] }[]) =>
        children.forEach((_, i) => {
          const at = [...path, i];
          const find = (m: typeof model) => at.reduce((t, k) => t.children[k]!, m.root);
          field<typeof model>(
            `topic ${at.join('.')}`,
            (m) => find(m).label,
            (m, t) => (find(m).label = t),
          );
          walk(at, (children[i] as { children: { children: unknown[] }[] }).children);
        });
      field<typeof model>(
        'central topic',
        (m) => m.root.label,
        (m, t) => (m.root.label = t),
      );
      walk([], model.root.children);
      break;
    }
    case 'timeline':
      field<typeof model>(
        'title',
        (m) => m.title,
        (m, t) => (m.title = t),
      );
      model.sections.forEach((section, s) => {
        if (section.label !== null) {
          field<typeof model>(
            `section ${s}`,
            (m) => m.sections[s]!.label!,
            (m, t) => (m.sections[s]!.label = t),
          );
        }
        section.periods.forEach((period, p) => {
          field<typeof model>(
            `period ${s}.${p}`,
            (m) => m.sections[s]!.periods[p]!.label,
            (m, t) => (m.sections[s]!.periods[p]!.label = t),
          );
          period.events.forEach((_, e) =>
            field<typeof model>(
              `event ${s}.${p}.${e}`,
              (m) => m.sections[s]!.periods[p]!.events[e]!,
              (m, t) => (m.sections[s]!.periods[p]!.events[e] = t),
            ),
          );
        });
      });
      break;
    case 'gantt':
      field<typeof model>(
        'title',
        (m) => m.title,
        (m, t) => (m.title = t),
      );
      model.sections.forEach((section, s) => {
        if (section.label !== null) {
          field<typeof model>(
            `section ${s}`,
            (m) => m.sections[s]!.label!,
            (m, t) => (m.sections[s]!.label = t),
          );
        }
        section.tasks.forEach((_, t) =>
          field<typeof model>(
            `task ${s}.${t}`,
            (m) => m.sections[s]!.tasks[t]!.name,
            (m, text) => (m.sections[s]!.tasks[t]!.name = text),
          ),
        );
      });
      break;
    case 'pie':
      field<typeof model>(
        'title',
        (m) => m.title,
        (m, t) => (m.title = t),
      );
      model.slices.forEach((_, i) =>
        field<typeof model>(
          `slice ${i}`,
          (m) => m.slices[i]!.label,
          (m, t) => (m.slices[i]!.label = t),
        ),
      );
      break;
  }
  return fields;
}

export interface CorpusDiagram {
  name: string;
  code: string;
}

/**
 * Text a user may type into any field: empty, spaces at the ends, Mermaid's syntax and
 * entity codes, keywords, quotes, line breaks and other scripts.
 */
export const TEXT_SAMPLES = [
  '',
  ' ',
  'Hello ',
  '  lead',
  'a|b',
  'a]b',
  'a)b',
  'a}b',
  'a;b',
  'a:b',
  'a: b',
  'ends:',
  '10:30',
  'a%%b',
  '%% not a comment',
  'end',
  'a<br>b',
  'line\nbreak',
  '#35;',
  'Issue #5',
  '#5; and #quot;',
  '#',
  'a "b" c',
  '"quoted"',
  'a [b] c',
  'a (b) c',
  'a {b} c',
  'a@b',
  'a & b',
  'a < b > c',
  'x as y',
  'a, b',
  'title',
  'section x',
  'click',
  'café ☕ 日本',
  '`code`',
  '::icon(fa fa-book)',
  ':::cls',
  'wrap: x',
  'a/b\\c',
  '/start',
  'end\\',
  '50%',
  "it's",
  '-->',
];

const docs = (name: string, code: string): CorpusDiagram => ({ name: `docs: ${name}`, code });
const own = (name: string, code: string): CorpusDiagram => ({ name, code });

export const DIAGRAM_CORPUS: CorpusDiagram[] = [
  // Flowcharts (mermaid.js.org/syntax/flowchart)
  docs('a node', 'flowchart LR\n    id'),
  docs('a node with text', 'flowchart LR\n    id1[This is the text in the box]'),
  docs('direction', 'flowchart TD\n    Start --> Stop'),
  docs('round', 'flowchart LR\n    id1(This is the text in the box)'),
  docs('stadium', 'flowchart LR\n    id1([This is the text in the box])'),
  docs('subroutine', 'flowchart LR\n    id1[[This is the text in the box]]'),
  docs('cylinder', 'flowchart LR\n    id1[(Database)]'),
  docs('circle', 'flowchart LR\n    id1((This is the text in the circle))'),
  docs('asymmetric', 'flowchart LR\n    id1>This is the text in the box]'),
  docs('rhombus', 'flowchart LR\n    id1{This is the text in the box}'),
  docs('hexagon', 'flowchart LR\n    id1{{This is the text in the box}}'),
  docs('parallelogram', 'flowchart TD\n    id1[/This is the text in the box/]'),
  docs('parallelogram alt', 'flowchart TD\n    id1[\\This is the text in the box\\]'),
  docs('trapezoid', 'flowchart TD\n    A[/Christmas\\]'),
  docs('trapezoid alt', 'flowchart TD\n    B[\\Go shopping/]'),
  docs('double circle', 'flowchart TD\n    id1(((This is the text in the circle)))'),
  docs('arrow', 'flowchart LR\n    A-->B'),
  docs('open link', 'flowchart LR\n    A --- B'),
  docs('text on a link', 'flowchart LR\n    A-- This is the text! ---B'),
  docs('text between bars', 'flowchart LR\n    A---|This is the text|B'),
  docs('arrow with text', 'flowchart LR\n    A-->|text|B'),
  docs('arrow with text in the middle', 'flowchart LR\n    A-- text -->B'),
  docs('dotted', 'flowchart LR\n   A-.->B;'),
  docs('dotted with text', 'flowchart LR\n   A-. text .-> B'),
  docs('thick', 'flowchart LR\n   A ==> B'),
  docs('thick with text', 'flowchart LR\n   A == text ==> B'),
  docs('invisible', 'flowchart LR\n    A ~~~ B'),
  docs('chain', 'flowchart LR\n   A -- text --> B -- text2 --> C'),
  docs('and', 'flowchart LR\n   a --> b & c--> d'),
  docs('and on both sides', 'flowchart TB\n    A & B--> C & D'),
  docs('circle edge', 'flowchart LR\n    A --o B'),
  docs('cross edge', 'flowchart LR\n    A --x B'),
  docs('both ways', 'flowchart LR\n    A o--o B\n    B <--> C\n    C x--x D'),
  docs(
    'link lengths',
    'flowchart TD\n    A[Start] --> B{Is it?}\n    B -->|Yes| C[OK]\n    C --> D[Rethink]\n    D --> B\n    B ---->|No| E[End]',
  ),
  docs('quotes', 'flowchart LR\n    id1["This is the (text) in the box"]'),
  docs(
    'entity codes',
    '    flowchart LR\n        A["A double quote:#quot;"] --> B["A dec char:#9829;"]',
  ),
  docs(
    'subgraphs',
    'flowchart TB\n    c1-->a2\n    subgraph one\n    a1-->a2\n    end\n    subgraph two\n    b1-->b2\n    end\n    subgraph three\n    c1-->c2\n    end',
  ),
  docs(
    'subgraph with an id',
    'flowchart TB\n    c1-->a2\n    subgraph ide1 [one]\n    a1-->a2\n    end',
  ),
  docs(
    'links to subgraphs',
    'flowchart TB\n    c1-->a2\n    subgraph one\n    a1-->a2\n    end\n    subgraph two\n    b1-->b2\n    end\n    subgraph three\n    c1-->c2\n    end\n    one --> two\n    three --> two\n    two --> c2',
  ),
  docs(
    'directions in subgraphs',
    'flowchart LR\n  subgraph TOP\n    direction TB\n    subgraph B1\n        direction RL\n        i1 -->f1\n    end\n    subgraph B2\n        direction BT\n        i2 -->f2\n    end\n  end\n  A --> TOP --> B\n  B1 --> B2',
  ),
  docs(
    'clicks',
    'flowchart LR\n    A-->B\n    B-->C\n    C-->D\n    click A callback "Tooltip for a callback"\n    click B "https://www.github.com" "This is a tooltip for a link"\n    click C call callback() "Tooltip for a callback"\n    click D href "https://www.github.com" "This is a tooltip for a link"',
  ),
  docs(
    'comments',
    'flowchart LR\n%% this is a comment A -- text --> B{node}\n   A -- text --> B -- text2 --> C',
  ),
  docs(
    'styles',
    'flowchart LR\n    id1(Start)-->id2(Stop)\n    style id1 fill:#f9f,stroke:#333,stroke-width:4px\n    style id2 fill:#bbf,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5',
  ),
  docs('a class', 'flowchart LR\n    A:::someclass --> B\n    classDef someclass fill:#f96'),
  docs(
    'classes',
    'flowchart LR\n    A:::foo & B:::bar --> C:::foobar\n    classDef foo stroke:#f00\n    classDef bar stroke:#0f0\n    classDef foobar stroke:#00f',
  ),
  docs(
    'icons',
    'flowchart TD\n    B["fa:fa-twitter for peace"]\n    B-->C[fa:fa-ban forbidden]\n    B-->D(fa:fa-spinner)\n    B-->E(A fa:fa-camera-retro perhaps?)',
  ),
  docs(
    'shapes and links',
    'flowchart LR\n    A[Hard edge] -->|Link text| B(Round edge)\n    B --> C{Decision}\n    C -->|One| D[Result one]\n    C -->|Two| E[Result two]',
  ),
  docs(
    'graph',
    'graph TD\n    A[Christmas] -->|Get money| B(Go shopping)\n    B --> C{Let me think}\n    C -->|One| D[Laptop]\n    C -->|Two| E[iPhone]\n    C -->|Three| F[fa:fa-car Car]',
  ),
  own(
    'flowchart: chains, comments and colours by hand',
    'flowchart LR\n  %% the order flow\n  A[Order received] --> B{Paid?}\n  B -->|yes| C([Ship]) --> D[(Archive)]\n  B -- no --> E((Refund))\n\n  subgraph shop [Shop floor]\n    direction TB\n    C\n    F:::m-green\n  end\n  style A fill:#f9f\n  linkStyle 0 stroke:red\n  classDef m-green fill:#dcf7e1,stroke:#3eab5e,color:#085023\n  class A,B m-green\n  click A "https://example.com"',
  ),
  own('flowchart: semicolons', 'graph TD;\n    A-->B; B-->C;\n    C-->D'),
  own('flowchart: CRLF and a trailing line', 'flowchart LR\r\n    A --> B\r\n    B --> C\r\n'),
  own(
    'flowchart: front matter and a directive',
    '---\ntitle: Shop\n---\n%%{init: {"flowchart": {"curve": "basis"}}}%%\nflowchart TD\n    A --> B\n',
  ),
  own(
    'flowchart: a titled group',
    'flowchart TB\n    subgraph Shop floor\n        A --> B\n    end\n    B --> C',
  ),
  // Sequence diagrams (mermaid.js.org/syntax/sequenceDiagram)
  docs(
    'sequence',
    'sequenceDiagram\n    Alice->>John: Hello John, how are you?\n    John-->>Alice: Great!\n    Alice-)John: See you later!',
  ),
  docs(
    'participants',
    'sequenceDiagram\n    participant Alice\n    participant Bob\n    Bob->>Alice: Hi Alice\n    Alice->>Bob: Hi Bob',
  ),
  docs(
    'actors',
    'sequenceDiagram\n    actor Alice\n    actor Bob\n    Alice->>Bob: Hi Bob\n    Bob->>Alice: Hi Alice',
  ),
  docs(
    'aliases',
    'sequenceDiagram\n    participant A as Alice\n    participant J as John\n    A->>J: Hello John, how are you?\n    J->>A: Great!',
  ),
  docs(
    'activations',
    'sequenceDiagram\n    Alice->>John: Hello John, how are you?\n    activate John\n    John-->>Alice: Great!\n    deactivate John',
  ),
  docs(
    'activation shortcuts',
    'sequenceDiagram\n    Alice->>+John: Hello John, how are you?\n    Alice->>+John: John, can you hear me?\n    John-->>-Alice: Hi Alice, I can hear you!\n    John-->>-Alice: I feel great!',
  ),
  docs('a note', 'sequenceDiagram\n    participant John\n    Note right of John: Text in note'),
  docs(
    'a note over two',
    'sequenceDiagram\n    Alice->John: Hello John, how are you?\n    Note over Alice,John: A typical interaction',
  ),
  docs(
    'a loop',
    'sequenceDiagram\n    Alice->John: Hello John, how are you?\n    loop Every minute\n        John-->Alice: Great!\n    end',
  ),
  docs(
    'alternatives',
    'sequenceDiagram\n    Alice->>Bob: Hello Bob, how are you?\n    alt is sick\n        Bob->>Alice: Not so good :(\n    else is well\n        Bob->>Alice: Feeling fresh like a daisy\n    end\n    opt Extra response\n        Bob->>Alice: Thanks for asking\n    end',
  ),
  docs(
    'parallel',
    'sequenceDiagram\n    par Alice to Bob\n        Alice->>Bob: Hello guys!\n    and Alice to John\n        Alice->>John: Hello guys!\n    end\n    Bob-->>Alice: Hi Alice!\n    John-->>Alice: Hi Alice!',
  ),
  docs(
    'critical',
    'sequenceDiagram\n    critical Establish a connection to the DB\n        Service-->DB: connect\n    option Network timeout\n        Service-->Service: Log error\n    option Credentials rejected\n        Service-->Service: Log different error\n    end',
  ),
  docs(
    'break',
    'sequenceDiagram\n    Consumer-->API: Book something\n    API-->BookingService: Start booking process\n    break when the booking process fails\n        API-->Consumer: show failure\n    end\n    API-->BillingService: Start billing process',
  ),
  docs(
    'highlights',
    'sequenceDiagram\n    participant Alice\n    participant John\n\n    rect rgb(191, 223, 255)\n    note right of Alice: Alice calls John.\n    Alice->>+John: Hello John, how are you?\n    rect rgb(200, 150, 255)\n    Alice->>+John: John, can you hear me?\n    John-->>-Alice: Hi Alice, I can hear you!\n    end\n    John-->>-Alice: I feel great!\n    end\n    Alice ->>+ John: Did you want to go to the game tonight?\n    John -->>- Alice: Yeah! See you there.',
  ),
  docs(
    'comments',
    'sequenceDiagram\n    Alice->>John: Hello John, how are you?\n    %% this is a comment\n    John-->>Alice: Great!',
  ),
  docs(
    'entity codes',
    'sequenceDiagram\n    A->>B: I #9829; you!\n    B->>A: I #9829; you #infin; times more!',
  ),
  docs(
    'numbering',
    'sequenceDiagram\n    autonumber\n    Alice->>John: Hello John, how are you?\n    loop HealthCheck\n        John->>John: Fight against hypochondria\n    end\n    Note right of John: Rational thoughts!\n    John-->>Alice: Great!\n    John->>Bob: How about you?\n    Bob-->>John: Jolly good!',
  ),
  docs(
    'boxes',
    'sequenceDiagram\n    box Purple Alice & John\n    participant A\n    participant J\n    end\n    box Another Group\n    participant B\n    participant C\n    end\n    A->>J: Hello John, how are you?\n    J->>A: Great!\n    A->>B: Hello Bob, how is Charley?\n    B->>C: Hello Charley, how are you?',
  ),
  own(
    'sequence: two-space indents and a title',
    'sequenceDiagram\n  title: Signing in\n  actor U as User\n  U->>S: Sign in\n  alt ok\n    S-->>U: Token\n  else\n    S--xU: No\n  end\n',
  ),
  // Mind maps (mermaid.js.org/syntax/mindmap)
  docs(
    'mind map',
    'mindmap\n  root((mindmap))\n    Origins\n      Long history\n      ::icon(fa fa-book)\n      Popularisation\n        British popular psychology author Tony Buzan\n    Research\n      On effectiveness<br/>and features\n      On Automatic creation\n        Uses\n            Creative techniques\n            Strategic planning\n            Argument mapping\n    Tools\n      Pen and paper\n      Mermaid',
  ),
  docs('levels', 'mindmap\n    Root\n        A\n            B\n            C'),
  docs('square', 'mindmap\n    id[I am a square]'),
  docs('rounded', 'mindmap\n    id(I am a rounded square)'),
  docs('circle', 'mindmap\n    id((I am a circle))'),
  docs('bang', 'mindmap\n    id))I am a bang(('),
  docs('cloud', 'mindmap\n    id)I am a cloud('),
  docs('hexagon', 'mindmap\n    id{{I am a hexagon}}'),
  docs('default', 'mindmap\n    I am the default shape'),
  docs(
    'icons',
    'mindmap\n    Root\n        A\n        ::icon(fa fa-book)\n        B(B)\n        ::icon(mdi mdi-skull-outline)',
  ),
  docs(
    'classes',
    'mindmap\n    Root\n        A[A]\n        :::urgent large\n        B(B)\n        C',
  ),
  docs('unclear indentation', 'mindmap\nRoot\n    A\n    B\n    C'),
  own(
    'mind map: comments and mixed indents',
    'mindmap\n  root((Plan))\n    %% why we do it\n    Goals\n        Fast\n      Simple\n\n    Risks\n      id1[Scope]\n        ::icon(fa fa-bolt)\n',
  ),
  // Timelines (mermaid.js.org/syntax/timeline)
  docs(
    'timeline',
    'timeline\n    title History of Social Media Platform\n    2002 : LinkedIn\n    2004 : Facebook\n         : Google\n    2005 : YouTube\n    2006 : Twitter',
  ),
  docs(
    'sections',
    'timeline\n    title Timeline of Industrial Revolution\n    section 17th-20th century\n        Industry 1.0 : Machinery, Water power, Steam <br>power\n        Industry 2.0 : Electricity, Internal combustion engine, Mass production\n        Industry 3.0 : Electronics, Computers, Automation\n    section 21st century\n        Industry 4.0 : Internet, Robotics, Internet of Things\n        Industry 5.0 : Artificial intelligence, Big data, 3D printing',
  ),
  docs(
    'long events',
    "timeline\n    title England's History Timeline\n    section Stone Age\n      7600 BC : Britain's oldest known house was built in Orkney, Scotland\n      6000 BC : Sea levels rise and Britain becomes an island.<br> The people who live here are hunter-gatherers.\n    section Bronze Age\n      2300 BC : People arrive from Europe and settle in Britain. <br>They bring farming and metalworking.\n              : New styles of pottery and ways of burying the dead appear.\n      2200 BC : The last major building works are completed at Stonehenge.<br> People now bury their dead in stone circles.\n              : The first metal objects are made in Britain.Some other nice things happen. it is a good time to be alive.",
  ),
  docs(
    'sub-points',
    'timeline\n        title MermaidChart 2023 Timeline\n        section 2023 Q1 <br> Release Personal Tier\n          Bullet 1 : sub-point 1a : sub-point 1b\n               : sub-point 1c\n          Bullet 2 : sub-point 2a : sub-point 2b\n        section 2023 Q2 <br> Release XYZ Tier\n          Bullet 3 : sub-point <br> 3a : sub-point 3b\n               : sub-point 3c\n          Bullet 4 : sub-point 4a : sub-point 4b',
  ),
  own(
    'timeline: times and a direction',
    'timeline TD\n  %% a day\n  Morning : 9:30 stand-up : 10:15 review\n  Noon : Lunch\n',
  ),
  // Gantt charts (mermaid.js.org/syntax/gantt)
  docs(
    'gantt',
    'gantt\n    title A Gantt Diagram\n    dateFormat YYYY-MM-DD\n    section Section\n        A task          :a1, 2014-01-01, 30d\n        Another task    :after a1, 20d\n    section Another\n        Task in Another :2014-01-12, 12d\n        another task    :24d',
  ),
  docs(
    'full example',
    'gantt\n    dateFormat  YYYY-MM-DD\n    title       Adding GANTT diagram functionality to mermaid\n    excludes    weekends\n    %% (`excludes` accepts specific dates in YYYY-MM-DD format, days of the week ("sunday") or "weekends", but not the word "weekdays".)\n\n    section A section\n    Completed task            :done,    des1, 2014-01-06,2014-01-08\n    Active task               :active,  des2, 2014-01-09, 3d\n    Future task               :         des3, after des2, 5d\n    Future task2              :         des4, after des3, 5d\n\n    section Critical tasks\n    Completed task in the critical line :crit, done, 2014-01-06,24h\n    Implement parser and jison          :crit, done, after des1, 2d\n    Create tests for parser             :crit, active, 3d\n    Future task in critical line        :crit, 5d\n    Create tests for renderer           :2d\n    Add to mermaid                      :until isadded\n    Functionality added                 :milestone, isadded, 2014-01-25, 0d\n\n    section Documentation\n    Describe gantt syntax               :active, a1, after des1, 3d\n    Add gantt diagram to demo page      :after a1  , 20h\n    Add another diagram to demo page    :doc1, after a1  , 48h\n\n    section Last section\n    Describe gantt syntax               :after doc1, 3d\n    Add gantt diagram to demo page      :20h\n    Add another diagram to demo page    :48h',
  ),
  docs(
    'milestones',
    'gantt\n    dateFormat HH:mm\n    axisFormat %H:%M\n    Initial milestone : milestone, m1, 17:49, 2m\n    Task A : 10m\n    Task B : 5m\n    Final milestone : milestone, m2, 18:08, 4m',
  ),
  // Pie charts (mermaid.js.org/syntax/pie)
  docs(
    'pie',
    'pie title Pets adopted by volunteers\n    "Dogs" : 386\n    "Cats" : 85\n    "Rats" : 15',
  ),
  docs(
    'show data',
    '%%{init: {"pie": {"textPosition": 0.5}, "themeVariables": {"pieOuterStrokeWidth": "5px"}} }%%\npie showData\n    title Key elements in Product X\n    "Calcium" : 42.96\n    "Potassium" : 50.05\n    "Magnesium" : 10.01\n    "Iron" :  5',
  ),
  own(
    'pie: comments between slices',
    'pie\n  %% budget\n  "Rent" : 40\n\n  "Food" : 25.5\n  accTitle: Spending\n',
  ),
];
