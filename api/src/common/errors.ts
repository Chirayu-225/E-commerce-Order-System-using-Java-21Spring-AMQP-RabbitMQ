import { z, ZodType } from 'zod';

/** An error that maps 1:1 onto an HTTP response (RFC 7807-style problem body). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string, extra?: Record<string, unknown>) => new ApiError(400, code, msg, extra);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have access to this resource') => new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, msg: string, extra?: Record<string, unknown>) => new ApiError(409, code, msg, extra);

/** Validate untrusted input with zod and turn failures into a 400 that lists the offending fields. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = r.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
  throw new ApiError(400, 'VALIDATION_FAILED', 'Some fields are invalid', { fields });
}
