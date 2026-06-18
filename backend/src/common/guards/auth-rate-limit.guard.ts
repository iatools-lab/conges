import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

type AuthRoute =
  | 'signup'
  | 'login'
  | 'google'
  | 'forgot-password'
  | 'verify-otp'
  | 'reset-password';

type RateLimitPolicy = {
  maxAttempts: number;
  windowMs: number;
};

const DEFAULT_POLICIES: Record<AuthRoute, RateLimitPolicy> = {
  signup: { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  login: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  google: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  'forgot-password': { maxAttempts: 3, windowMs: 15 * 60 * 1000 },
  'verify-otp': { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  'reset-password': { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
};

const buckets = new Map<string, { attempts: number; resetAt: number }>();

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const route = this.getAuthRoute(request);
    if (!route) return true;

    const now = Date.now();
    const policy = this.getPolicy(route);
    const key = this.getBucketKey(request, route);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { attempts: 1, resetAt: now + policy.windowMs });
      this.pruneExpiredBuckets(now);
      return true;
    }

    if (bucket.attempts >= policy.maxAttempts) {
      throw new HttpException(
        'Trop de tentatives. Veuillez patienter avant de recommencer.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.attempts += 1;
    return true;
  }

  private getAuthRoute(request: Request): AuthRoute | null {
    if (request.method !== 'POST') return null;

    const path = request.path || request.url || '';
    const match = path.match(/\/auth\/([^/?#]+)/);
    const route = match?.[1];
    return this.isAuthRoute(route) ? route : null;
  }

  private isAuthRoute(value: string | undefined): value is AuthRoute {
    return (
      value === 'signup' ||
      value === 'login' ||
      value === 'google' ||
      value === 'forgot-password' ||
      value === 'verify-otp' ||
      value === 'reset-password'
    );
  }

  private getPolicy(route: AuthRoute): RateLimitPolicy {
    const routeKey = route.toUpperCase().replace(/-/g, '_');
    const defaultPolicy = DEFAULT_POLICIES[route];
    const maxAttempts =
      this.getPositiveInteger(`AUTH_RATE_LIMIT_${routeKey}_MAX`) ??
      this.getPositiveInteger('AUTH_RATE_LIMIT_MAX') ??
      defaultPolicy.maxAttempts;
    const windowSeconds =
      this.getPositiveInteger(`AUTH_RATE_LIMIT_${routeKey}_WINDOW_SECONDS`) ??
      this.getPositiveInteger('AUTH_RATE_LIMIT_WINDOW_SECONDS') ??
      Math.floor(defaultPolicy.windowMs / 1000);

    return {
      maxAttempts,
      windowMs: windowSeconds * 1000,
    };
  }

  private getPositiveInteger(key: string) {
    const value = Number(this.configService.get<string>(key));
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  private getBucketKey(request: Request, route: AuthRoute) {
    return [
      route,
      this.getRequestIp(request),
      this.getRequestEmail(request) ?? 'anonymous',
    ].join(':');
  }

  private getRequestIp(request: Request) {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown-ip';
  }

  private getRequestEmail(request: Request) {
    const body = request.body as { email?: unknown } | undefined;
    return typeof body?.email === 'string'
      ? body.email.trim().toLowerCase()
      : undefined;
  }

  private pruneExpiredBuckets(now: number) {
    if (buckets.size < 1000) return;

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }
}
