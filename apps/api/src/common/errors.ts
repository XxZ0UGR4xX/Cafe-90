import { errorMessage } from '@retroburger/shared';

/** Error de dominio: código estable + mensaje humano (es-MX). */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
    public readonly retryable = false,
    message?: string,
  ) {
    super(message ?? errorMessage(code));
  }
}

export const notFound = (what?: string) => new AppError('NOT_FOUND', 404, what ? { what } : undefined);
export const forbidden = (details?: unknown) => new AppError('FORBIDDEN', 403, details);
export const unauthenticated = () => new AppError('UNAUTHENTICATED', 401);
export const conflict = (details?: unknown, message?: string) => new AppError('CONFLICT', 409, details, false, message);
export const badRequest = (code: string, details?: unknown) => new AppError(code, 400, details);
