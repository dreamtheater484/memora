import { useEffect, useState } from 'react';

/*
 * How much of the window an on-screen keyboard covers (phones and tablets), so a toolbar can
 * sit just above it (§9.4). Zero where there is no such keyboard.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // Small differences are browser bars, not a keyboard.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
