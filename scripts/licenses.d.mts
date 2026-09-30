// Types for scripts/licenses.mjs, which apps/web/vite.config.ts uses.
export const ALLOWED: Set<string>;
export const HEADER: string;
export const SERVER_TITLE: string;
export function allowed(expression: string): boolean;
export function packageDirOf(file: string): string | null;
export function withDependencies(dir: string, seen?: Set<string>): Set<string>;
export function section(title: string, dirs: Iterable<string>): string;
export function combine(web?: string, server?: string): void;
