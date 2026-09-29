import type { ApiErrorBody, ApiErrorCode } from '@memora/shared';
import { z } from 'zod';

/** An error the client is meant to see: it becomes `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const notFound = (what = 'Not found') => new ApiError(404, 'not_found', what);

/** Validates a request part with a zod schema; failures become 400 with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new ApiError(400, 'invalid_request', 'Some fields are not valid.', { fields });
}
