/**
 * A short, human label for a session's device, like "Firefox on Windows", from the User-Agent.
 * Only for display in the sessions list, so rough is fine; no parsing library needed.
 * Order matters: Edge and Opera also claim to be Chrome, and Chrome claims to be Safari.
 */
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/curl\//, 'curl'],
];

// Android and ChromeOS also say "Linux"; iPhone and iPad also say "Mac OS X".
const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

export function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown device';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser';
  const os = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return os ? `${browser} on ${os}` : browser;
}
