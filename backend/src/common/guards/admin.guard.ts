import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import {
  SessionTokenPayload,
  resolveSessionSecret,
  SessionRole,
  verifySessionToken,
} from '../auth/session-token';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = req.path || req.url || '';
    if (req.method === 'OPTIONS') return true;

    const requiredRoles = this.getRequiredRoles(path);
    if (!requiredRoles) return true;

    const session = this.getSession(req);
    if (!session) return false;

    req.authSession = session;
    if (this.hasRequiredRole(session.roles, requiredRoles)) return true;

    return false;
  }

  private getRequiredRoles(path: string): SessionRole[] | null {
    if (path.startsWith('/api/v1/auth/profile'))
      return ['employee', 'manager', 'rh', 'admin'];
    if (path.startsWith('/api/v1/auth')) return null;
    if (path.startsWith('/api/v1/admin')) return ['admin'];
    if (path.startsWith('/api/v1/rh')) return ['rh', 'admin'];
    if (path.startsWith('/api/v1/manager')) return ['manager', 'admin'];
    if (path.startsWith('/api/v1/employee'))
      return ['employee', 'manager', 'rh', 'admin'];
    if (path.startsWith('/api/v1/notifications'))
      return ['employee', 'manager', 'rh', 'admin'];

    return null;
  }

  private getSession(req: Request): SessionTokenPayload | null {
    const token = this.getBearerToken(req);
    if (!token) return null;

    try {
      const result = verifySessionToken(
        token,
        resolveSessionSecret(
          this.configService.get<string>('AUTH_SESSION_SECRET'),
        ),
      );
      return result.valid ? result.payload : null;
    } catch {
      return null;
    }
  }

  private getBearerToken(req: Request) {
    const authorization = req.headers.authorization;
    if (!authorization) return undefined;

    const [type, token] = authorization.split(' ');
    if (type?.toLowerCase() !== 'bearer') return undefined;

    return token?.trim();
  }

  private hasRequiredRole(roles: SessionRole[], requiredRoles: SessionRole[]) {
    return roles.some((role) => requiredRoles.includes(role));
  }
}
