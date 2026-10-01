import { colourDefinition, type DiagramType } from '@memora/shared';

/*
 * The diagrams to start from (§9.4), grouped by type, each a little example of what the
 * type is for. "Blank" starts are the smallest diagram of their type.
 */

export interface DiagramTemplate {
  type: DiagramType | 'other';
  name: string;
  code: string;
}

export const TEMPLATES: DiagramTemplate[] = [
  {
    type: 'flowchart',
    name: 'Process',
    code: `flowchart LR
    n1(["Start"])
    n2["Collect the details"]
    n3["Check them"]
    n4(["Done"])
    n1 --> n2
    n2 --> n3
    n3 --> n4
    ${colourDefinition('green')}
    class n1,n4 m-green`,
  },
  {
    type: 'flowchart',
    name: 'Decision',
    code: `flowchart TD
    n1["Order received"]
    n2{"Paid?"}
    n3["Ship it"]
    n4["Send a reminder"]
    n1 --> n2
    n2 -->|"Yes"| n3
    n2 -->|"No"| n4
    n4 -.-> n2
    ${colourDefinition('yellow')}
    class n2 m-yellow`,
  },
  {
    type: 'flowchart',
    name: 'Teams',
    code: `flowchart LR
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
    n3 --> n4`,
  },
  {
    type: 'mindmap',
    name: 'Brainstorm',
    code: `mindmap
  root(("Big idea"))
    Why
      For whom
      What it solves
    How
      First step
      Tools
    Risks`,
  },
  {
    type: 'mindmap',
    name: 'Project outline',
    code: `mindmap
  root["Project"]
    Goals
    People
    Plan
      Phase 1
      Phase 2
    Budget`,
  },
  {
    type: 'sequence',
    name: 'Request and reply',
    code: `sequenceDiagram
    actor U as You
    participant A as App
    participant S as Server
    U->>A: Open a page
    A->>S: Ask for the page
    S-->>A: The page
    A-->>U: Show it`,
  },
  {
    type: 'sequence',
    name: 'Signing in',
    code: `sequenceDiagram
    autonumber
    actor U as User
    participant W as Website
    U->>W: Name and password
    alt Correct
        W-->>U: Welcome
    else Wrong
        W-->>U: Try again
    end`,
  },
  {
    type: 'timeline',
    name: 'Milestones',
    code: `timeline
    title Project milestones
    section Spring
        March : Kick-off
        April : First design : Feedback
    section Summer
        June : Launch`,
  },
  {
    type: 'gantt',
    name: 'Small project',
    code: `gantt
    title Small project
    dateFormat YYYY-MM-DD
    section Plan
    Research :done, t1, 2026-01-05, 5d
    Design :active, t2, after t1, 7d
    section Build
    Build it :t3, after t2, 10d
    Launch :milestone, after t3, 0d`,
  },
  {
    type: 'pie',
    name: 'Breakdown',
    code: `pie showData
    title Where the time goes
    "Meetings" : 30
    "Writing" : 45
    "Email" : 25`,
  },
  {
    type: 'other',
    name: 'Class diagram',
    code: `classDiagram
    class Animal {
        +String name
        +eat()
    }
    class Dog {
        +bark()
    }
    Animal <|-- Dog`,
  },
  {
    type: 'other',
    name: 'State diagram',
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review
    Review --> Published
    Review --> Draft
    Published --> [*]`,
  },
  {
    type: 'other',
    name: 'Entity relationships',
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE : contains
    PRODUCT ||--o{ LINE : "is in"`,
  },
  {
    type: 'other',
    name: 'User journey',
    code: `journey
    title Making tea
    section Kitchen
      Boil water: 5: Me
      Steep: 4: Me
    section Table
      Drink: 5: Me`,
  },
  {
    type: 'other',
    name: 'Quadrant chart',
    code: `quadrantChart
    title Ideas
    x-axis Low effort --> High effort
    y-axis Low value --> High value
    quadrant-1 Plan
    quadrant-2 Do now
    quadrant-3 Skip
    quadrant-4 Maybe
    Newsletter: [0.3, 0.6]
    New app: [0.8, 0.9]`,
  },
  {
    type: 'other',
    name: 'Git graph',
    code: `gitGraph
    commit
    branch feature
    commit
    checkout main
    merge feature
    commit`,
  },
];

/** The smallest diagram of each type, for "Blank". */
export const BLANK: Record<DiagramType, string> = {
  flowchart: 'flowchart LR\n    n1["Start"]',
  mindmap: 'mindmap\n  root(("Topic"))',
  sequence:
    'sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello',
  timeline: 'timeline\n    title Timeline\n    Today : Something happens',
  gantt: `gantt\n    dateFormat YYYY-MM-DD\n    Task :${new Date().toISOString().slice(0, 10)}, 3d`,
  pie: 'pie\n    "One" : 1\n    "Two" : 1',
};

export const TEMPLATE_GROUPS: { type: DiagramType | 'other'; name: string }[] = [
  { type: 'flowchart', name: 'Flowcharts' },
  { type: 'mindmap', name: 'Mind maps' },
  { type: 'sequence', name: 'Sequence diagrams' },
  { type: 'timeline', name: 'Timelines' },
  { type: 'gantt', name: 'Gantt charts' },
  { type: 'pie', name: 'Pie charts' },
  { type: 'other', name: 'Other diagrams (edited as code)' },
];
