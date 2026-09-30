import { useEffect, useState } from 'react';
import { Skeleton } from '../components/ui';

/**
 * A QR code, drawn as one SVG path. Always dark on white, as scanners expect, in either
 * theme. The encoder is loaded when a code is first shown (only while setting up two-step
 * verification).
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [shape, setShape] = useState<{ size: number; path: string } | null>(null);

  useEffect(() => {
    let live = true;
    void import('uqr').then(({ encode }) => {
      const { size, data } = encode(text, { ecc: 'M', border: 2 });
      let path = '';
      data.forEach((row, y) =>
        row.forEach((dark, x) => {
          if (dark) path += `M${x} ${y}h1v1h-1z`;
        }),
      );
      if (live) setShape({ size, path });
    });
    return () => {
      live = false;
    };
  }, [text]);

  if (!shape) return <Skeleton className="size-44 rounded-lg" />;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${shape.size} ${shape.size}`}
      className="size-44 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={shape.path} fill="#000" />
    </svg>
  );
}
