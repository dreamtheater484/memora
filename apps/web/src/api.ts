import { type HealthResponse, healthResponseSchema } from '@memora/shared';

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Server responded with ${response.status}`);
  return healthResponseSchema.parse(await response.json());
}
