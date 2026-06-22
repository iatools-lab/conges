import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

function createGuard(config: Record<string, string | undefined> = {}) {
  return new AuthRateLimitGuard({
    get: jest.fn((key: string) => config[key]),
  } as any);
}

function createContext(
  path: string,
  body: Record<string, unknown> = {},
  ip = '10.0.0.1',
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        path,
        url: path,
        ip,
        socket: { remoteAddress: ip },
        body,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthRateLimitGuard', () => {
  it('blocks auth attempts after the configured limit', () => {
    const guard = createGuard({
      AUTH_RATE_LIMIT_LOGIN_MAX: '2',
      AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS: '60',
    });
    const context = createContext('/api/v1/auth/login', {
      email: 'user@upowa.org',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });

  it('tracks auth attempts separately by email', () => {
    const guard = createGuard({
      AUTH_RATE_LIMIT_LOGIN_MAX: '1',
      AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS: '60',
    });

    expect(
      guard.canActivate(
        createContext(
          '/api/v1/auth/login',
          { email: 'first@upowa.org' },
          '10.0.0.2',
        ),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        createContext(
          '/api/v1/auth/login',
          { email: 'second@upowa.org' },
          '10.0.0.2',
        ),
      ),
    ).toBe(true);
  });

  it('ignores non-auth routes', () => {
    expect(createGuard().canActivate(createContext('/api/v1/healthz'))).toBe(
      true,
    );
  });
});
