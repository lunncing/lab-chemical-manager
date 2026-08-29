import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import type { UserView } from '../../shared/types.js';

export type AuthedRequest = Request & { user: UserView };

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_ERROR') { super(message); }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, result.error.issues.map((item) => item.message).join('；'), 'VALIDATION_ERROR');
  return result.data;
}

export function asyncRoute(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
}

export function roleRequired(...roles: UserView['role'][]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const req = request as AuthedRequest;
    if (!roles.includes(req.user.role)) return next(new HttpError(403, '权限不足', 'FORBIDDEN'));
    next();
  };
}
