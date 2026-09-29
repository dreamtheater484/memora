import { markedParts } from '@memora/shared';

/** Text with the server's match markers shown as highlights (never as HTML). */
export function Marked({ text }: { text: string }) {
  return (
    <>
      {markedParts(text).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-xs bg-accent/20 px-px text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
