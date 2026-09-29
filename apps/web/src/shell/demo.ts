import type { SectionColorId } from '../theme/sections';

/*
 * Placeholder content for the Phase 1 shell. Later phases replace this with
 * data from the API; the shape roughly follows the real model.
 */

export interface DemoSection {
  id: string;
  name: string;
  color: SectionColorId;
  /** Section group within the notebook, if any. */
  group?: string;
}

export interface DemoNotebook {
  id: string;
  name: string;
  color: SectionColorId;
  sections: DemoSection[];
}

export interface DemoPage {
  id: string;
  title: string;
  kind: 'markdown' | 'rich';
  snippet: string;
  edited: string;
  children?: DemoPage[];
}

export interface DemoBoard {
  id: string;
  name: string;
}

export interface DemoProject {
  id: string;
  name: string;
  color: SectionColorId;
  boards: DemoBoard[];
}

export const NOTEBOOKS: DemoNotebook[] = [
  {
    id: 'work',
    name: 'Work',
    color: 'indigo',
    sections: [
      { id: 'roadmap', name: 'Roadmap', color: 'blue', group: 'Projects' },
      { id: 'research', name: 'Research', color: 'teal', group: 'Projects' },
      { id: 'meetings', name: 'Meetings', color: 'amber', group: 'Projects' },
      { id: 'team', name: 'Team', color: 'violet' },
      { id: 'archive', name: 'Archive', color: 'slate' },
    ],
  },
  {
    id: 'personal',
    name: 'Personal',
    color: 'green',
    sections: [
      { id: 'travel', name: 'Travel', color: 'cyan' },
      { id: 'recipes', name: 'Recipes', color: 'orange' },
      { id: 'reading', name: 'Reading', color: 'coral' },
    ],
  },
  {
    id: 'side',
    name: 'Side projects',
    color: 'magenta',
    sections: [
      { id: 'garden', name: 'Garden', color: 'lime' },
      { id: 'ideas', name: 'Ideas', color: 'magenta' },
    ],
  },
];

export const PROJECTS: DemoProject[] = [
  {
    id: 'web',
    name: 'Website',
    color: 'cyan',
    boards: [
      { id: 'relaunch', name: 'Website relaunch' },
      { id: 'content', name: 'Content calendar' },
    ],
  },
  {
    id: 'garden-app',
    name: 'Garden app',
    color: 'green',
    boards: [{ id: 'sprint', name: 'Sprint board' }],
  },
];

export const PAGES: Record<string, DemoPage[]> = {
  roadmap: [
    {
      id: 'q4',
      title: 'Q4 roadmap',
      kind: 'markdown',
      snippet: 'Ship the offline outbox first, then polish search.',
      edited: '2 min ago',
      children: [
        {
          id: 'drn',
          title: 'Design review notes',
          kind: 'markdown',
          snippet: 'Offline badge stays until the outbox is empty.',
          edited: 'Yesterday',
        },
        {
          id: 'launch',
          title: 'Launch checklist',
          kind: 'markdown',
          snippet: 'Backups, smoke test, announcement draft.',
          edited: 'Mon',
        },
      ],
    },
    {
      id: 'pricing',
      title: 'Pricing experiments',
      kind: 'rich',
      snippet: 'Three tiers tested; the annual discount wins.',
      edited: 'Sep 22',
    },
    {
      id: 'openq',
      title: 'Open questions',
      kind: 'markdown',
      snippet: 'Do boards need swimlanes in the first version?',
      edited: 'Sep 18',
    },
    {
      id: 'retro',
      title: 'Retro — September',
      kind: 'rich',
      snippet: 'Went well: fewer meetings. Improve: estimates.',
      edited: 'Sep 12',
    },
  ],
  research: [
    {
      id: 'comp',
      title: 'Competitor notes',
      kind: 'rich',
      snippet: 'Quick scan of two note apps from interviews.',
      edited: 'Today',
    },
    {
      id: 'interview',
      title: 'Interview synthesis',
      kind: 'markdown',
      snippet: '12 interviews, 4 themes. Top pain: trusting sync.',
      edited: 'Sep 24',
      children: [
        {
          id: 'bench',
          title: 'Pricing benchmarks',
          kind: 'rich',
          snippet: 'Median price of self-hosted tools.',
          edited: 'Sep 17',
        },
      ],
    },
    {
      id: 'offline',
      title: 'Offline mode — spec',
      kind: 'markdown',
      snippet: 'Edits go to the outbox and replay in order.',
      edited: 'Sep 15',
    },
  ],
  travel: [
    {
      id: 'lisbon',
      title: 'Lisbon trip',
      kind: 'rich',
      snippet: 'Tram 28 early, Belém on Tuesday.',
      edited: 'Aug 30',
    },
  ],
  recipes: [
    {
      id: 'sourdough',
      title: 'Sourdough schedule',
      kind: 'markdown',
      snippet: 'Feed at 8, bulk until 2, shape and cold proof.',
      edited: 'Aug 21',
    },
  ],
};

export function findSection(id: string): { notebook: DemoNotebook; section: DemoSection } | null {
  for (const notebook of NOTEBOOKS) {
    const section = notebook.sections.find((s) => s.id === id);
    if (section) return { notebook, section };
  }
  return null;
}

/** Pages of a section in display order, subpages after their parent. */
export function flatPages(sectionId: string): DemoPage[] {
  const out: DemoPage[] = [];
  const walk = (list: DemoPage[]) => {
    for (const p of list) {
      out.push(p);
      if (p.children) walk(p.children);
    }
  };
  walk(PAGES[sectionId] ?? []);
  return out;
}
