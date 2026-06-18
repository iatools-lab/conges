import { createHmac, timingSafeEqual } from 'node:crypto';

export type SessionRole = 'employee' | 'manager' | 'rh' | 'admin';

export type SessionTokenPayload = {
  sub: string;
  email: string;
  roles: SessionRole[];
  iat: number;
  exp: number;
};

type TokenVerification =
  | { valid: true; payload: SessionTokenPayload }
  | { valid: false };

const DEV_SESSION_SECRET = 'dev-only-upowa-session-secret-change-before-prod';

export function resolveSessionSecret(
  configuredSecret: string | undefined,
  nodeEnv = process.env.NODE_ENV,
) {
  const secret = configuredSecret?.trim();
  if (secret) return secret;

  if (nodeEnv === 'production') {
    throw new Error('AUTH_SESSION_SECRET est requis en production');
  }

  return DEV_SESSION_SECRET;
}

export function createSessionToken(
  params: {
    sub: string;
    email: string;
    roles: SessionRole[];
    ttlSeconds: number;
  },
  secret: string,
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    sub: params.sub,
    email: params.email,
    roles: Array.from(new Set(params.roles)),
    iat: issuedAt,
    exp: issuedAt + params.ttlSeconds,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
): TokenVerification {
  const [encodedPayload, signature, ...extra] = token?.split('.') ?? [];
  if (!encodedPayload || !signature || extra.length > 0)
    return { valid: false };

  const expectedSignature = sign(encodedPayload, secret);
  if (!isSameSignature(signature, expectedSignature)) return { valid: false };

  const payload = parsePayload(encodedPayload);
  if (!payload) return { valid: false };
  if (payload.exp <= Math.floor(Date.now() / 1000)) return { valid: false };

  return { valid: true, payload };
}

function sign(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function isSameSignature(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function parsePayload(encodedPayload: string): SessionTokenPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as unknown;
    if (!isPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isPayload(value: unknown): value is SessionTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<SessionTokenPayload>;

  return (
    typeof payload.sub === 'string' &&
    typeof payload.email === 'string' &&
    Array.isArray(payload.roles) &&
    payload.roles.every(isSessionRole) &&
    typeof payload.iat === 'number' &&
    typeof payload.exp === 'number'
  );
}

function isSessionRole(value: unknown): value is SessionRole {
  return (
    value === 'employee' ||
    value === 'manager' ||
    value === 'rh' ||
    value === 'admin'
  );
}
