import {
  createSessionToken,
  resolveSessionSecret,
  verifySessionToken,
} from './session-token';

const secret = 'test-session-secret-with-more-than-32-characters';

describe('session-token', () => {
  it('creates and verifies a signed session token', () => {
    const token = createSessionToken(
      {
        sub: 'user-1',
        email: 'user@upowa.org',
        roles: ['employee', 'manager'],
        ttlSeconds: 3600,
      },
      secret,
    );

    const result = verifySessionToken(token, secret);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toEqual(
        expect.objectContaining({
          sub: 'user-1',
          email: 'user@upowa.org',
          roles: ['employee', 'manager'],
        }),
      );
    }
  });

  it('rejects tampered and expired tokens', () => {
    const token = createSessionToken(
      {
        sub: 'user-1',
        email: 'user@upowa.org',
        roles: ['admin'],
        ttlSeconds: 3600,
      },
      secret,
    );
    const expired = createSessionToken(
      {
        sub: 'user-1',
        email: 'user@upowa.org',
        roles: ['admin'],
        ttlSeconds: -1,
      },
      secret,
    );

    expect(verifySessionToken(`${token}x`, secret).valid).toBe(false);
    expect(verifySessionToken(expired, secret).valid).toBe(false);
  });

  it('requires an explicit session secret in production', () => {
    expect(() => resolveSessionSecret(undefined, 'production')).toThrow(
      'AUTH_SESSION_SECRET est requis en production',
    );
    expect(resolveSessionSecret(undefined, 'development')).toBeTruthy();
  });
});
