import { FileText, SquareKanban } from 'lucide-react';
import type { ReactNode } from 'react';
import { Chip } from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';

function Block({
  title,
  children,
  extra,
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className="border-b border-line pb-3.5 last:border-b-0">
      <h2 className={cn(sectionHeading, 'mb-2 flex items-center justify-between')}>
        {title}
        {extra}
      </h2>
      {children}
    </section>
  );
}

const REVISIONS = [
  ['Today, 10:42', 'You · current version'],
  ['Today, 09:15', 'You · 14 lines changed'],
  ['Yesterday, 17:03', 'Priya · table updated'],
  ['26 Sep, 11:20', 'Imported from Markdown'],
];

/** Page details on wide screens: outline, backlinks, tags, history, info. */
export function Inspector() {
  return (
    <aside
      aria-label="Page details"
      className="flex h-full min-h-0 flex-col gap-3.5 overflow-auto px-4 pt-4 pb-7"
    >
      <Block title="Outline">
        <nav aria-label="Outline" className="flex flex-col text-sm">
          {['Milestones', 'This week', 'Notes'].map((h, i) => (
            <a
              key={h}
              href={`#${h}`}
              aria-current={i === 0 || undefined}
              className="rounded-[6px] px-2 py-1 text-fg-2 hover:bg-hover aria-[current]:bg-hover aria-[current]:font-semibold aria-[current]:text-fg"
            >
              {h}
            </a>
          ))}
        </nav>
      </Block>
      <Block title="Backlinks" extra={<span>3</span>}>
        {[
          [<FileText key="i" />, 'Design review notes', 'Roadmap · dates live in Q4 roadmap'],
          [<FileText key="i" />, 'Standup — Sep 28', 'Meetings · see Q4 roadmap for milestones'],
          [<SquareKanban key="i" />, 'WEB-14 · Offline outbox', 'Website relaunch · In progress'],
        ].map(([icon, title, sub]) => (
          <div
            key={String(title)}
            className="flex gap-2.5 rounded-sm px-2 py-1.5 text-sm hover:bg-hover [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-3"
          >
            {icon}
            <span>
              {title}
              <small className="block text-xs leading-snug text-fg-3">{sub}</small>
            </span>
          </div>
        ))}
      </Block>
      <Block title="Tags">
        <div className="flex flex-wrap gap-1.5">
          <Chip>#roadmap</Chip>
          <Chip>#q4</Chip>
          <Chip>#docs</Chip>
        </div>
      </Block>
      <Block title="Version history">
        <ol>
          {REVISIONS.map(([when, what], i) => (
            <li key={when} className="relative pb-3 pl-5 text-xs text-fg-3 last:pb-0">
              <span
                aria-hidden
                className={cn(
                  'absolute top-1 left-0.5 size-2 rounded-full border-[1.5px]',
                  i === 0 ? 'border-ok bg-ok' : 'border-line-strong bg-panel',
                )}
              />
              {i < REVISIONS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-3.5 bottom-0 left-[0.4rem] w-px bg-line"
                />
              )}
              <b className="block text-sm font-semibold text-fg">{when}</b>
              {what}
            </li>
          ))}
        </ol>
      </Block>
      <Block title="Info">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-xs">
          <dt className="text-fg-3">Created</dt>
          <dd>3 Sep 2026</dd>
          <dt className="text-fg-3">Words</dt>
          <dd>186</dd>
          <dt className="text-fg-3">Revision</dt>
          <dd>42</dd>
        </dl>
      </Block>
    </aside>
  );
}
