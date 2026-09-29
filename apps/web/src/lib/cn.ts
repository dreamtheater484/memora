export type ClassValue = string | false | null | undefined | 0;

/** Joins class names, skipping empty values. */
export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
