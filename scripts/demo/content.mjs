/*
 * The demo dataset (Phase 13): made-up notes of a made-up person, for trying Memora and for
 * the documentation's screenshots. Everything here is fictional.
 */

export const notebooks = [
  {
    name: 'Work',
    color: 'blue',
    icon: 'briefcase',
    sections: [
      { name: 'Meetings', color: 'indigo' },
      { name: 'Website relaunch', color: 'blue', group: 'Projects' },
      { name: 'Q4 planning', color: 'teal', group: 'Projects' },
      { name: 'Research', color: 'violet' },
    ],
  },
  {
    name: 'Home',
    color: 'green',
    icon: 'house',
    sections: [
      { name: 'Recipes', color: 'orange' },
      { name: 'Garden', color: 'lime' },
      { name: 'Travel', color: 'cyan' },
    ],
  },
  {
    name: 'Learning',
    color: 'violet',
    icon: 'graduation-cap',
    sections: [
      { name: 'Physics', color: 'magenta' },
      { name: 'Spanish', color: 'amber' },
    ],
  },
];

/** Display width: emoji and East Asian wide characters take two columns (as in the editor). */
const width = (value) =>
  [...value].reduce(
    (sum, ch) =>
      sum +
      (/\p{Extended_Pictographic}|[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/u.test(
        ch,
      )
        ? 2
        : 1),
    0,
  );

/** Pads Markdown tables so their pipes line up, keeping each column's alignment. */
export function alignTables(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].startsWith('|')) {
      out.push(lines[i++]);
      continue;
    }
    const block = [];
    while (i < lines.length && lines[i].startsWith('|')) block.push(lines[i++]);
    const rows = block.map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    );
    const align = rows[1].map((c) =>
      c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : 'l',
    );
    const widths = align.map((_, col) =>
      Math.max(3, ...rows.filter((_, r) => r !== 1).map((cells) => width(cells[col] ?? ''))),
    );
    const pad = (value, col) => {
      const gap = widths[col] - width(value);
      if (align[col] === 'r') return ' '.repeat(gap) + value;
      if (align[col] === 'c')
        return ' '.repeat(Math.floor(gap / 2)) + value + ' '.repeat(Math.ceil(gap / 2));
      return value + ' '.repeat(gap);
    };
    rows.forEach((cells, r) => {
      const shown =
        r === 1
          ? align.map((a, col) =>
              a === 'c'
                ? `:${'-'.repeat(widths[col] - 2)}:`
                : a === 'r'
                  ? `${'-'.repeat(widths[col] - 1)}:`
                  : '-'.repeat(widths[col]),
            )
          : cells.map(pad);
      out.push(`| ${shown.join(' | ')} |`);
    });
  }
  return out.join('\n');
}

export const markdownPages = (day) =>
  rawMarkdownPages(day).map((p) => ({ ...p, content: alignTables(p.content) }));

const rawMarkdownPages = (day) => [
  {
    section: 'Website relaunch',
    title: 'Website relaunch plan',
    tags: ['planning', 'web'],
    view: 'split',
    content: `# Website relaunch

> [!NOTE]
> Launch on **${day(45)}**. The board tracks the work: WEB-1 to WEB-9.

## Goals

- Pages load in under a second on a phone
- Every article readable without a single pop-up
- A search that finds things by what they are about

## Timeline

| Phase     | Weeks | Owner | Status      |
| --------- | ----: | ----- | ----------- |
| Content   |     3 | Sam   | done        |
| Design    |     2 | Priya | doing       |
| Build     |     4 | Jamie | next        |
| Launch 🚀 |     1 | Alex  | planned     |

## How it flows

\`\`\`mermaid
flowchart LR
  Content --> Design --> Build --> Review --> Launch
  Review -- changes --> Build
\`\`\`

## Budget

The hosting cost per month is $c = 20 + 0.08\\,n$ euros for $n$ thousand visits.

See also [[Team sync]] and [[Q4 goals]].
`,
  },
  {
    section: 'Website relaunch',
    title: 'Launch checklist',
    parent: 'Website relaunch plan',
    tags: ['web'],
    content: `# Launch checklist

- [x] Redirects from the old addresses
- [x] Analytics without cookies
- [ ] Load test with 500 visitors at once (WEB-7)
- [ ] Announce it in the newsletter
`,
  },
  {
    section: 'Meetings',
    title: 'Team sync',
    tags: ['meeting'],
    content: `# Team sync — ${day(-2)}

**Present:** Alex, Sam, Priya, Jamie

## Decisions

1. The new navigation ships with the relaunch, not before.
2. Old articles keep their addresses.

## Actions

- [ ] Priya: final colours for the dark theme (WEB-4)
- [ ] Jamie: estimate the search work
- [x] Sam: move the last 40 articles

Next time: the [[Website relaunch plan]] timeline.
`,
  },
  {
    section: 'Q4 planning',
    title: 'Q4 goals',
    tags: ['planning'],
    content: `# Q4 goals

| Goal                         | Measure                 | Confidence |
| ---------------------------- | ----------------------- | :--------: |
| Relaunch the website         | Live by ${day(45)} |    high    |
| Newsletter to 5 000 readers  | Subscribers             |   medium   |
| Two talks at meetups         | Talks given             |    low     |
`,
  },
  {
    section: 'Q4 planning',
    title: 'Relaunch ideas',
    tags: ['planning', 'web'],
    content: `# Relaunch ideas

\`\`\`mermaid
mindmap
  root((Relaunch))
    Content
      Move old articles
      New guides
      Newsletter
    Design
      Dark theme
      Faster pages
    People
      Priya
      Sam
    Launch
      Load test
      Announcement
\`\`\`

Sorted out in [[Team sync]]; the plan is in [[Website relaunch plan]].
`,
  },
  {
    section: 'Research',
    title: 'Static site generators',
    tags: ['web', 'idea'],
    content: `# Static site generators

Compared for the relaunch: build time for 2 000 pages.

\`\`\`bash
time npm run build
\`\`\`

| Tool   | Build (s) | Notes                |
| ------ | --------: | -------------------- |
| Astro  |       38 | Islands, good images |
| Hugo   |        4 | Fastest, Go templates |
| Eleventy |     21 | Simple, flexible     |
`,
  },
  {
    section: 'Recipes',
    title: 'Sourdough bread',
    tags: ['recipe'],
    view: 'preview',
    content: `# Sourdough bread

One loaf, about 900 g. Start the evening before.

| Ingredient     | Grams | Baker's % |
| -------------- | ----: | --------: |
| Bread flour    |   450 |       90% |
| Whole wheat    |    50 |       10% |
| Water          |   375 |       75% |
| Starter        |   100 |       20% |
| Salt           |    10 |        2% |

1. Mix flour and water; rest for an hour.
2. Add the starter and salt, fold four times in the first two hours.
3. Shape, then rest in the fridge overnight.
4. Bake at 250 °C for 20 minutes with a lid, 25 without.

> [!TIP]
> The dough is ready to shape when it has grown by about half.
`,
  },
  {
    section: 'Garden',
    title: 'Planting calendar',
    tags: ['garden'],
    content: `# Planting calendar

| Month     | Sow                    | Harvest            |
| --------- | ---------------------- | ------------------ |
| March     | Tomatoes (inside)      | —                  |
| April     | Peas, lettuce          | Radishes           |
| May       | Beans, courgettes      | Lettuce            |
| August    | Winter spinach         | Tomatoes, beans    |
`,
  },
  {
    section: 'Physics',
    title: 'The pendulum',
    content: `# The pendulum

For small swings, the period depends only on the length $L$ and gravity $g$:

$$
T = 2\\pi \\sqrt{\\frac{L}{g}}
$$

A one-metre pendulum swings in about **2.0 s**.
`,
  },
];

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content) => ({ type: 'paragraph', content });
const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const cell = (type, value, attrs) => ({
  type,
  ...(attrs ? { attrs } : {}),
  content: [paragraph(text(value))],
});
const row = (type, values) => ({ type: 'tableRow', content: values.map((v) => cell(type, v)) });
const task = (value, checked) => ({
  type: 'taskItem',
  attrs: { checked },
  content: [paragraph(text(value))],
});

export const richPages = () => [
  {
    section: 'Recipes',
    title: 'Weekly menu',
    tags: ['recipe'],
    content: {
      type: 'doc',
      content: [
        heading(1, 'Weekly menu'),
        paragraph(
          text('Shopping on '),
          text('Saturday', [{ type: 'bold' }]),
          text('; leftovers on '),
          text('Wednesday', [{ type: 'highlight' }]),
          text('.'),
        ),
        {
          type: 'table',
          content: [
            row('tableHeader', ['Day', 'Lunch', 'Dinner']),
            row('tableCell', ['Monday', 'Lentil soup', 'Mushroom risotto']),
            row('tableCell', ['Tuesday', 'Salad with feta', 'Fish tacos']),
            row('tableCell', ['Wednesday', 'Leftovers', 'Leftovers']),
            row('tableCell', ['Thursday', 'Omelette', 'Curry with rice']),
            row('tableCell', ['Friday', 'Sandwiches', 'Pizza night']),
          ],
        },
        {
          type: 'callout',
          attrs: { kind: 'tip' },
          content: [paragraph(text('The sourdough needs starting on Thursday evening.'))],
        },
      ],
    },
  },
  {
    section: 'Travel',
    title: 'Lisbon trip',
    tags: ['travel'],
    content: {
      type: 'doc',
      content: [
        heading(1, 'Lisbon trip'),
        paragraph(text('Four days in spring, by train from Madrid.')),
        heading(2, 'Before we go'),
        {
          type: 'taskList',
          content: [
            task('Book the night train', true),
            task('Tram 28 tickets', false),
            task('Reserve the tile museum', false),
          ],
        },
        heading(2, 'Places'),
        {
          type: 'bulletList',
          content: [
            'Alfama and the castle',
            'Belém: the tower and pastéis',
            'Sintra, a day trip',
          ].map((value) => ({ type: 'listItem', content: [paragraph(text(value))] })),
        },
      ],
    },
  },
  {
    section: 'Spanish',
    title: 'Irregular verbs',
    tags: ['idea'],
    content: {
      type: 'doc',
      content: [
        heading(1, 'Irregular verbs'),
        {
          type: 'table',
          content: [
            row('tableHeader', ['', 'ser', 'ir', 'tener']),
            row('tableCell', ['yo', 'soy', 'voy', 'tengo']),
            row('tableCell', ['tú', 'eres', 'vas', 'tienes']),
            row('tableCell', ['nosotros', 'somos', 'vamos', 'tenemos']),
          ],
        },
      ],
    },
  },
];

export const template = {
  name: 'Meeting notes',
  type: 'markdown',
  content: `# {{title}} — {{date}}

**Present:**

## Decisions

## Actions

- [ ] `,
};

export const board = (day) => ({
  project: {
    name: 'Website relaunch',
    key: 'WEB',
    color: 'blue',
    icon: 'rocket',
    template: 'extended',
  },
  labels: [
    { name: 'Design', color: 'violet' },
    { name: 'Frontend', color: 'blue' },
    { name: 'Content', color: 'green' },
    { name: 'Bug', color: 'coral' },
  ],
  columns: [
    { name: 'Backlog' },
    { name: 'To do' },
    { name: 'In progress', wipLimit: 3 },
    { name: 'Review', color: 'amber' },
    { name: 'Done', isDone: true },
  ],
  cards: [
    {
      column: 'Done',
      title: 'Move the old articles',
      labels: ['Content'],
      update: { priority: 'medium', completed: true },
    },
    {
      column: 'Done',
      title: 'Redirect map for old addresses',
      labels: ['Frontend'],
      update: { priority: 'high', completed: true },
    },
    {
      column: 'Review',
      title: 'New navigation',
      labels: ['Design', 'Frontend'],
      update: { priority: 'high', dueDate: day(3) },
      notes: ['Website relaunch plan'],
      comments: ['Looks great on phones. One more pass on the tablet width?'],
    },
    {
      column: 'In progress',
      title: 'Dark theme colours',
      labels: ['Design'],
      update: { priority: 'medium', dueDate: day(6) },
      checklist: {
        title: 'Screens',
        items: [
          ['Home', true],
          ['Article', true],
          ['Search', false],
        ],
      },
    },
    {
      column: 'In progress',
      title: 'Image sizes for phones',
      labels: ['Frontend'],
      update: { priority: 'high', dueDate: day(8) },
    },
    {
      column: 'In progress',
      title: 'Search results page',
      labels: ['Frontend', 'Design'],
      update: { priority: 'medium' },
    },
    {
      column: 'To do',
      title: 'Load test with 500 visitors',
      labels: ['Frontend'],
      update: { priority: 'urgent', dueDate: day(20) },
      notes: ['Launch checklist'],
    },
    {
      column: 'To do',
      title: 'Newsletter announcement',
      labels: ['Content'],
      update: { priority: 'low', dueDate: day(44) },
    },
    {
      column: 'Backlog',
      title: 'Broken links in the 2019 archive',
      labels: ['Bug'],
      update: { priority: 'low' },
    },
  ],
});
