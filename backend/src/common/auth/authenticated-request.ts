import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionTokenPayload } from './session-token';

export type AuthenticatedRequest = Request & {
  authSession?: SessionTokenPayload;
};

export function requireAuthSession(req: AuthenticatedRequest) {
  if (!req.authSession) {
    throw new UnauthorizedException('Session authentifiee requise');
  }

  return req.authSession;
}

export function withAuthenticatedUser<T extends object>(
  input: T | undefined,
  session: SessionTokenPayload,
) {
  return {
    ...((input ?? {}) as T),
    userId: session.sub,
    userEmail: session.email,
  } as T & { userId: string; userEmail: string };
}

export function withAuthenticatedManager<T extends object>(
  input: T | undefined,
  session: SessionTokenPayload,
) {
  return {
    ...((input ?? {}) as T),
    managerId: session.sub,
    managerEmail: session.email,
  } as T & { managerId: string; managerEmail: string };
}

export function withAuthenticatedRh<T extends object>(
  input: T | undefined,
  session: SessionTokenPayload,
) {
  return {
    ...((input ?? {}) as T),
    rhId: session.sub,
    rhEmail: session.email,
  } as T & { rhId: string; rhEmail: string };
}
