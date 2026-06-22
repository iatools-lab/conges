import { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { createSessionToken } from '../auth/session-token';

const secret = 'test-session-secret-with-more-than-32-characters';
const originalNodeEnv = process.env.NODE_ENV;

function createGuard() {
  return new AdminGuard({ get: jest.fn().mockReturnValue(secret) } as any);
}

function createContext(path: string, headers: Record<string, string> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path, url: path, method: 'GET', headers }),
    }),
  } as unknown as ExecutionContext;
}

function token(roles: Array<'employee' | 'manager' | 'rh' | 'admin'>) {
  return createSessionToken(
    {
      sub: 'user-1',
      email: 'user@upowa.org',
      roles,
      ttlSeconds: 3600,
    },
    secret,
  );
}

describe('AdminGuard', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('allows public auth routes without a token', () => {
    expect(createGuard().canActivate(createContext('/api/v1/auth/login'))).toBe(
      true,
    );
  });

  it('accepts signed role tokens on protected routes', () => {
    process.env.NODE_ENV = 'production';

    expect(
      createGuard().canActivate(
        createContext('/api/v1/admin/users', {
          authorization: `Bearer ${token(['admin'])}`,
        }),
      ),
    ).toBe(true);
    expect(
      createGuard().canActivate(
        createContext('/api/v1/employee/planning', {
          authorization: `Bearer ${token(['employee'])}`,
        }),
      ),
    ).toBe(true);
  });

  it('rejects unsigned role headers in production', () => {
    process.env.NODE_ENV = 'production';

    expect(
      createGuard().canActivate(
        createContext('/api/v1/admin/users', { 'x-user-roles': 'admin' }),
      ),
    ).toBe(false);

    expect(
      createGuard().canActivate(
        createContext('/api/v1/admin/roles', {
          authorization: `Bearer ${token(['rh'])}`,
        }),
      ),
    ).toBe(false);
  });

  it('rejects unsigned role headers in development', () => {
    process.env.NODE_ENV = 'development';

    expect(
      createGuard().canActivate(
        createContext('/api/v1/admin/users', { 'x-user-roles': 'admin' }),
      ),
    ).toBe(false);
  });

  it('rejects tokens without a required role', () => {
    process.env.NODE_ENV = 'production';

    expect(
      createGuard().canActivate(
        createContext('/api/v1/admin/users', {
          authorization: `Bearer ${token(['employee'])}`,
        }),
      ),
    ).toBe(false);
  });
});
