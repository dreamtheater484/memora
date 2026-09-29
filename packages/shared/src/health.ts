import { z } from 'zod';

/** Response of `GET /api/health`. Deliberately minimal: it is reachable without logging in. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
