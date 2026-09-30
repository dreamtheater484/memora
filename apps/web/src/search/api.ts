import {
  MODIFIED_WITHIN,
  PAGE_TYPES,
  type CreateTemplateRequest,
  type ModifiedWithin,
  type PageType,
  type SearchQuery,
  type SearchResponse,
  type Template,
  type UpdateTemplateRequest,
} from '@memora/shared';
import { keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/*
 * Search, backlinks and templates, as the server has them (§9.8, §9.9). They need a
 * connection; search falls back to titles on this device without one.
 */

/** The search view's address: `/search?q=…&tag=…&notebook=…&type=…&modified=…`. */
export interface SearchParams {
  q?: string;
  tag?: string;
  notebook?: string;
  type?: PageType;
  modified?: ModifiedWithin;
  /** Leave Kanban cards out (`cards=0`); they are searched too by default. */
  cards?: '0';
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** Reads the address's search params, dropping anything unknown. */
export function validateSearchParams(search: Record<string, unknown>): SearchParams {
  const type = text(search.type);
  const modified = text(search.modified);
  return {
    q: text(search.q),
    tag: text(search.tag),
    notebook: text(search.notebook),
    type: PAGE_TYPES.includes(type as PageType) ? (type as PageType) : undefined,
    modified: MODIFIED_WITHIN.includes(modified as ModifiedWithin)
      ? (modified as ModifiedWithin)
      : undefined,
    cards: search.cards === '0' || search.cards === 0 ? '0' : undefined,
  };
}

/** The query string for `GET /search`, leaving out what isn't set. */
function searchParams(query: SearchQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const searchQuery = (query: SearchQuery) =>
  queryOptions({
    queryKey: ['search', query],
    queryFn: () => api<SearchResponse>('GET', `/search?${searchParams(query)}`),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: false,
  });

export const backlinksQuery = (pageId: string) =>
  queryOptions({
    queryKey: ['backlinks', pageId],
    queryFn: () => api<{ pages: string[] }>('GET', `/pages/${pageId}/backlinks`),
    staleTime: 10_000,
    retry: false,
  });

export const templatesQuery = queryOptions({
  queryKey: ['templates'],
  queryFn: () => api<Template[]>('GET', '/templates'),
  staleTime: 60_000,
});

export async function saveTemplate(queryClient: QueryClient, input: CreateTemplateRequest) {
  const created = await api<Template>('POST', '/templates', input);
  await queryClient.invalidateQueries({ queryKey: ['templates'] });
  return created;
}

export async function updateTemplate(
  queryClient: QueryClient,
  id: string,
  patch: UpdateTemplateRequest,
) {
  await api<Template>('PATCH', `/templates/${id}`, patch);
  await queryClient.invalidateQueries({ queryKey: ['templates'] });
}

export async function deleteTemplate(queryClient: QueryClient, id: string) {
  await api<void>('DELETE', `/templates/${id}`);
  await queryClient.invalidateQueries({ queryKey: ['templates'] });
}
