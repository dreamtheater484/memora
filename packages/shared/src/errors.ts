/** Every API error has this shape (§10): `{ error: { code, message, details? } }`. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export const API_ERROR_CODES = [
  'invalid_request',
  'unauthenticated',
  'forbidden',
  'csrf_failed',
  'password_change_required',
  'not_found',
  'conflict',
  'too_many_requests',
  'invalid_credentials',
  'account_disabled',
  'invalid_setup_code',
  'already_set_up',
  'weak_password',
  'wrong_password',
  'username_taken',
  'last_admin',
  'invalid_move',
  'too_deep',
  'revision_conflict',
  'asset_exists',
  'file_too_large',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
