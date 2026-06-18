import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
];

const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;
const CORS_ALLOWED_HEADERS = 'Authorization, Content-Type';
const CORS_ALLOWED_METHODS = 'GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS';

function getCorsOrigins(configService: ConfigService): string[] {
  const configuredOrigins = configService.get<string>('CORS_ORIGINS');
  const origins = configuredOrigins
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : DEFAULT_CORS_ORIGINS;
}

function assertProductionConfig(configService: ConfigService) {
  if (process.env.NODE_ENV !== 'production') return;

  const requiredKeys = [
    'AUTH_SESSION_SECRET',
    'AUTH_ADMIN_PASSWORD_HASH',
    'CORS_ORIGINS',
  ];
  const missingKeys = requiredKeys.filter(
    (key) => !configService.get<string>(key)?.trim(),
  );

  if (missingKeys.length > 0) {
    throw new Error(
      `Configuration production incomplète: ${missingKeys.join(', ')}`,
    );
  }

  const placeholderKeys = requiredKeys.filter((key) => {
    const value = configService.get<string>(key)?.trim() ?? '';
    return /change_me|change-me|replace-with/i.test(value);
  });

  if (placeholderKeys.length > 0) {
    throw new Error(
      `Configuration production non personnalisee: ${placeholderKeys.join(', ')}`,
    );
  }

  const sessionSecret = configService.get<string>('AUTH_SESSION_SECRET') ?? '';
  if (sessionSecret.trim().length < 32) {
    throw new Error(
      'AUTH_SESSION_SECRET doit contenir au moins 32 caractères en production',
    );
  }
}

function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return process.env.NODE_ENV !== 'production' && LOCAL_DEV_ORIGIN.test(origin);
}

export function configureApp(
  app: INestApplication,
  configService: ConfigService,
) {
  assertProductionConfig(configService);
  const allowedOrigins = getCorsOrigins(configService);

  app.setGlobalPrefix('api/v1');
  app.use((request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin;
    const allowedOrigin = Array.isArray(origin)
      ? undefined
      : isAllowedCorsOrigin(origin, allowedOrigins)
        ? origin
        : undefined;

    if (allowedOrigin) {
      response.header('Access-Control-Allow-Origin', allowedOrigin);
      response.header('Access-Control-Allow-Credentials', 'true');
      response.header('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
      response.header('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
      response.header('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.sendStatus(allowedOrigin ? 204 : 403);
      return;
    }

    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
