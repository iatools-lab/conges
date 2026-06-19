/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { verifySessionToken } from '../../common/auth/session-token';

const secret = 'test-session-secret-with-more-than-32-characters';
const originalNodeEnv = process.env.NODE_ENV;

function createService(config: Record<string, string | undefined>) {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    department: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  } as any;
  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as any;
  const emailService = {
    send: jest.fn(),
    sendMany: jest.fn(),
  } as any;

  return {
    service: new AuthService(prisma, configService, emailService),
    prisma,
  };
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    matricule: 'M001',
    nom: 'Jean',
    prenom: 'Dupont',
    email: 'user@upowa.org',
    poste: 'Employe',
    status: 'ACTIVE',
    passwordHash: null,
    department: null,
    roles: [],
    ...overrides,
  };
}

describe('AuthService', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('rejects admin email login without a password', async () => {
    process.env.NODE_ENV = 'production';
    const { service } = createService({ AUTH_SESSION_SECRET: secret });

    await expect(
      service.login({ email: 'admin@upowa.org' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires a configured admin password hash in production', async () => {
    process.env.NODE_ENV = 'production';
    const { service } = createService({ AUTH_SESSION_SECRET: secret });

    await expect(
      service.login({ email: 'admin@upowa.org', password: 'Admin123!' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns a signed admin session with a configured admin hash', async () => {
    process.env.NODE_ENV = 'production';
    const bootstrap = createService({ AUTH_SESSION_SECRET: secret });
    const adminPasswordHash = (bootstrap.service as any).hashPassword(
      'Admin123!',
    );
    const { service, prisma } = createService({
      AUTH_SESSION_SECRET: secret,
      AUTH_ADMIN_PASSWORD_HASH: adminPasswordHash,
    });

    const session = await service.login({
      email: 'admin@upowa.org',
      password: 'Admin123!',
    });

    expect(session).toEqual(
      expect.objectContaining({
        id: 'admin-upowa',
        token: expect.any(String),
      }),
    );
    expect(verifySessionToken(session.token, secret).valid).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          entityId: 'admin-upowa',
        }),
      }),
    );
  });

  it('creates a password only for an existing user account', async () => {
    process.env.NODE_ENV = 'production';
    const { service, prisma } = createService({
      AUTH_SESSION_SECRET: secret,
    });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      passwordHash: null,
      status: 'ACTIVE',
    });
    prisma.user.update.mockResolvedValue(
      activeUser({
        roles: [],
      }),
    );

    const session = await service.signup({
      email: 'user@upowa.org',
      password: 'Secret123!',
      confirmPassword: 'Secret123!',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { passwordHash: expect.any(String) },
      }),
    );
    expect(session).toEqual(
      expect.objectContaining({
        id: 'user-1',
        token: expect.any(String),
      }),
    );
  });

  it('rejects signup when password confirmation differs', async () => {
    const { service, prisma } = createService({ AUTH_SESSION_SECRET: secret });

    await expect(
      service.signup({
        email: 'user@upowa.org',
        password: 'Secret123!',
        confirmPassword: 'Secret1234!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns a signed session token after an email login', async () => {
    process.env.NODE_ENV = 'production';
    const { service, prisma } = createService({
      AUTH_SESSION_SECRET: secret,
      AUTH_SESSION_TTL_HOURS: '1',
    });
    const passwordHash = (service as any).hashPassword('Secret123!');
    prisma.user.findUnique.mockResolvedValue(activeUser({ passwordHash }));

    const session = await service.login({
      email: 'user@upowa.org',
      password: 'Secret123!',
    });

    expect(session).toEqual(
      expect.objectContaining({
        id: 'user-1',
        token: expect.any(String),
        expiresAt: expect.any(String),
      }),
    );
    expect(verifySessionToken(session.token, secret).valid).toBe(true);
  });

  it('blocks every password operation when Google-only mode is enabled', async () => {
    const { service, prisma } = createService({
      AUTH_GOOGLE_ONLY: 'true',
      AUTH_SESSION_SECRET: secret,
    });

    const operations = [
      () =>
        service.signup({
          email: 'user@upowa.org',
          password: 'Secret123!',
          confirmPassword: 'Secret123!',
        }),
      () =>
        service.login({
          email: 'user@upowa.org',
          password: 'Secret123!',
        }),
      () => service.forgotPassword({ email: 'user@upowa.org' }),
      () => service.verifyOtp({ email: 'user@upowa.org', code: '123456' }),
      () =>
        service.resetPassword({
          email: 'user@upowa.org',
          code: '123456',
          newPassword: 'NewSecret123!',
        }),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects password login before the password is created', async () => {
    process.env.NODE_ENV = 'production';
    const prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      department: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      matricule: 'M001',
      nom: 'Jean',
      prenom: 'Dupont',
      email: 'user@upowa.org',
      poste: 'Employé',
      status: 'ACTIVE',
      passwordHash: null,
      department: null,
      roles: [],
    });
    const configService = {
      get: jest.fn((key: string) =>
        key === 'AUTH_SESSION_SECRET' ? secret : undefined,
      ),
    } as any;
    const emailService = {
      send: jest.fn(),
      sendMany: jest.fn(),
    } as any;
    const service = new AuthService(prisma, configService, emailService);

    await expect(
      service.login({ email: 'user@upowa.org', password: 'Secret123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an incorrect stored password', async () => {
    process.env.NODE_ENV = 'production';
    const { service, prisma } = createService({
      AUTH_SESSION_SECRET: secret,
      AUTH_SESSION_TTL_HOURS: '1',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      matricule: 'M001',
      nom: 'Jean',
      prenom: 'Dupont',
      email: 'user@upowa.org',
      poste: 'Employé',
      status: 'ACTIVE',
      passwordHash:
        '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f:4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f',
      department: null,
      roles: [],
    });

    await expect(
      service.login({ email: 'user@upowa.org', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires GOOGLE_CLIENT_ID for Google login', async () => {
    const { service } = createService({ AUTH_SESSION_SECRET: secret });

    await expect(
      service.loginWithGoogle({ credential: 'token', clientId: 'client-id' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects unexpected Google client ids', async () => {
    const { service } = createService({
      AUTH_SESSION_SECRET: secret,
      GOOGLE_CLIENT_ID: 'expected-client-id',
    });

    await expect(
      service.loginWithGoogle({
        credential: 'token',
        clientId: 'other-client',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns a signed session token after a valid Google login', async () => {
    const { service, prisma } = createService({
      AUTH_SESSION_SECRET: secret,
      GOOGLE_CLIENT_ID: 'expected-client-id',
    });
    prisma.user.findUnique.mockResolvedValue(
      activeUser({ passwordHash: 'an-existing-password-hash' }),
    );
    (service as any).googleClient = {
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({
          email: 'user@upowa.org',
          email_verified: true,
        }),
      }),
    };

    const session = await service.loginWithGoogle({
      credential: 'token',
      clientId: 'expected-client-id',
    });

    expect(session).toEqual(
      expect.objectContaining({
        id: 'user-1',
        token: expect.any(String),
      }),
    );
    expect(verifySessionToken(session.token, secret).valid).toBe(true);
  });

  it('allows the principal admin to authenticate with its verified Google account', async () => {
    const { service, prisma } = createService({
      AUTH_GOOGLE_ONLY: 'true',
      AUTH_SESSION_SECRET: secret,
      GOOGLE_CLIENT_ID: 'expected-client-id',
    });
    (service as any).googleClient = {
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({
          email: 'admin@upowa.org',
          email_verified: true,
        }),
      }),
    };

    const session = await service.loginWithGoogle({
      credential: 'token',
      clientId: 'expected-client-id',
    });

    expect(session).toEqual(
      expect.objectContaining({
        id: 'admin-upowa',
        primaryRole: 'admin',
      }),
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          metadata: { method: 'google' },
        }),
      }),
    );
  });

  it('hashes OTP codes with a unique salt', () => {
    const { service } = createService({ AUTH_SESSION_SECRET: secret });
    const firstHash = (service as any).hashOtp('123456');
    const secondHash = (service as any).hashOtp('123456');

    expect(firstHash).toMatch(/^otp:v2:/);
    expect(secondHash).toMatch(/^otp:v2:/);
    expect(firstHash).not.toBe(secondHash);
    expect((service as any).verifyOtpCode('123456', firstHash)).toBe(true);
    expect((service as any).verifyOtpCode('000000', firstHash)).toBe(false);
  });
});
