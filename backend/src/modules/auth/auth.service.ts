import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpStatus, OtpType, RoleType, UserStatus } from '@prisma/client';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
  VerifyOtpDto,
} from './dto/login.dto';
import {
  createSessionToken,
  resolveSessionSecret,
  verifySessionToken,
} from '../../common/auth/session-token';
import { EmailService } from '../shared/notifications/email.service';
import { Request } from 'express';

type AppRole = 'employee' | 'manager' | 'rh' | 'admin';
type AuthenticationMethod = 'google' | 'password';

const ADMIN_EMAIL = 'ia.tools@upowa.org';
const DEV_ADMIN_PASSWORD_HASH =
  'bca31eae832b08108d2ea8abc4bf28c3:4c64e7c503efd92c7e6d61d35fe85cc79cadc6ab6e797ff92df63ad58739f964d9a4b39143cc50dd11a55555370847ec20ec7a2f6091ece1f69ecae399e30f71';

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async signup(dto: SignupDto, req?: Request) {
    this.assertPasswordAuthenticationEnabled();
    const email = dto.email.trim().toLowerCase();
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Les mots de passe ne correspondent pas.');
    }
    // Vérifier si l'utilisateur existe déjà dans le système (créé par admin)
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, status: true },
    });
    if (!existingUser) {
      throw new BadRequestException(
        "Aucun compte n'a été créé pour cet email. Contactez votre administrateur.",
      );
    }
    if (existingUser.passwordHash) {
      throw new ConflictException(
        'Le mot de passe a déjà été défini pour ce compte.',
      );
    }
    if (existingUser.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'Ce compte est inactif. Contactez votre administrateur.',
      );
    }

    // Hasher le mot de passe
    const passwordHash = this.hashPassword(dto.password);

    // Définir le mot de passe sur le compte créé par l'admin.
    const user = await this.prisma.user.update({
      where: { id: existingUser.id },
      data: { passwordHash },
      select: {
        id: true,
        matricule: true,
        email: true,
        nom: true,
        prenom: true,
        poste: true,
        department: { select: { id: true, code: true, name: true } },
        roles: { select: { role: true } },
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'SIGNUP',
        entity: 'User',
        entityId: user.id,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    // Créer la session automatiquement après inscription
    const roles = this.toAppRoles(user.roles.map((r) => r.role));
    const primaryRole = this.pickPrimaryRole(roles);

    return {
      id: user.id,
      matricule: user.matricule,
      email: user.email,
      name: `${user.prenom} ${user.nom}`.trim(),
      poste: user.poste,
      department: user.department,
      roles,
      primaryRole,
      homePath: this.getHomePath(primaryRole),
      token: this.createToken(user.id, user.email, roles),
      expiresAt: this.toExpiryIso(),
    };
  }

  async login(dto: LoginDto, req?: Request) {
    this.assertPasswordAuthenticationEnabled();
    const email = dto.email.trim().toLowerCase();
    const password = dto.password?.trim();

    try {
      const session = await this.createSessionForEmail(
        email,
        'password',
        password,
      );

      // Audit log - login réussi
      await this.prisma.auditLog.create({
        data: {
          userId: this.getAuditUserId(session.id),
          action: 'LOGIN',
          entity: 'User',
          entityId: session.id,
          ipAddress: req?.ip,
          userAgent: req?.headers['user-agent'],
        },
      });

      return session;
    } catch (error) {
      // Audit log - login échoué
      const user = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      await this.prisma.auditLog.create({
        data: {
          userId: user?.id,
          action: 'LOGIN_FAILED',
          entity: 'User',
          entityId: user?.id,
          metadata: {
            email,
            reason: error instanceof Error ? error.message : 'unknown',
          },
          ipAddress: req?.ip,
          userAgent: req?.headers['user-agent'],
        },
      });

      throw error;
    }
  }

  async loginWithGoogle(dto: GoogleLoginDto, req?: Request) {
    const configuredClientId = this.configService
      .get<string>('GOOGLE_CLIENT_ID')
      ?.trim();
    const clientId = dto.clientId.trim();

    if (!configuredClientId) {
      throw new ServiceUnavailableException(
        'GOOGLE_CLIENT_ID est requis pour la connexion Google',
      );
    }

    if (clientId !== configuredClientId) {
      throw new UnauthorizedException('Client Google invalide');
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.credential,
        audience: configuredClientId,
      });
      const payload = ticket.getPayload();
      const email = payload?.email?.trim().toLowerCase();

      if (!email || !payload?.email_verified) {
        throw new UnauthorizedException('Compte Google non vérifié');
      }

      const session = await this.createSessionForEmail(email, 'google');

      // Audit log
      await this.prisma.auditLog.create({
        data: {
          userId: this.getAuditUserId(session.id),
          action: 'LOGIN',
          entity: 'User',
          entityId: session.id,
          metadata: { method: 'google' },
          ipAddress: req?.ip,
          userAgent: req?.headers['user-agent'],
        },
      });

      return session;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Connexion Google invalide');
    }
  }

  async forgotPassword(dto: ForgotPasswordDto, req?: Request) {
    this.assertPasswordAuthenticationEnabled();
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    // Ne pas révéler si l'email existe ou non (sécurité)
    if (!user || user.status === UserStatus.INACTIVE) {
      // On simule un succès pour ne pas révéler l'existence du compte
      return {
        message:
          'Si cet email existe, un code de réinitialisation a été envoyé.',
      };
    }

    // Désactiver les OTP précédents en cours
    await this.prisma.otpRequest.updateMany({
      where: {
        userId: user.id,
        status: OtpStatus.PENDING,
        type: OtpType.PASSWORD_RESET,
      },
      data: { status: OtpStatus.EXPIRED },
    });

    // Générer un OTP de 6 chiffres
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = this.hashOtp(otpCode);

    // Stocker l'OTP haché
    await this.prisma.otpRequest.create({
      data: {
        userId: user.id,
        type: OtpType.PASSWORD_RESET,
        code: otpHash,
        status: OtpStatus.PENDING,
        maxAttempts: 3,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      },
    });

    // Envoyer l'OTP par email
    await this.emailService.send({
      to: email,
      subject: 'Code de réinitialisation de mot de passe',
      text: `Votre code de réinitialisation est: ${otpCode}\n\nCe code est valable 5 minutes.\n\nSi vous n'avez pas demandé cette réinitialisation, ignorez cet email.`,
      html: `<div style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc">
        <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e2e8f0">
          <h2 style="color:#0f172a;margin:0 0 16px">Code de réinitialisation</h2>
          <p style="color:#475569;font-size:15px;line-height:1.5">Voici votre code à 6 chiffres pour réinitialiser votre mot de passe :</p>
          <div style="text-align:center;padding:24px 0">
            <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#0f766e;font-family:monospace">${otpCode}</span>
          </div>
          <p style="color:#94a3b8;font-size:13px">Ce code expire dans 5 minutes. Ne le partagez avec personne.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
          <p style="color:#94a3b8;font-size:12px">Si vous n'avez pas demandé ce code, ignorez simplement cet email.</p>
        </div>
      </div>`,
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'FORGOT_PASSWORD',
        entity: 'User',
        entityId: user.id,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    return {
      message: 'Si cet email existe, un code de réinitialisation a été envoyé.',
    };
  }

  async verifyOtp(dto: VerifyOtpDto, req?: Request) {
    this.assertPasswordAuthenticationEnabled();
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('Email non valide');
    }

    // Récupérer le dernier OTP en cours
    const otpRequest = await this.prisma.otpRequest.findFirst({
      where: {
        userId: user.id,
        type: OtpType.PASSWORD_RESET,
        status: OtpStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRequest) {
      throw new BadRequestException(
        'Aucun code de vérification en cours. Veuillez en demander un nouveau.',
      );
    }

    // Vérifier l'expiration
    if (new Date() > otpRequest.expiresAt) {
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { status: OtpStatus.EXPIRED },
      });
      throw new BadRequestException(
        'Le code a expiré. Veuillez en demander un nouveau.',
      );
    }

    // Vérifier le nombre de tentatives
    if (otpRequest.attempts >= otpRequest.maxAttempts) {
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { status: OtpStatus.MAX_ATTEMPTS },
      });
      throw new BadRequestException(
        'Trop de tentatives. Veuillez demander un nouveau code.',
      );
    }

    // Vérifier le code (comparaison hash)
    const isValid = this.verifyOtpCode(code, otpRequest.code);
    if (!isValid) {
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { attempts: { increment: 1 } },
      });

      // Audit log - tentative échouée
      await this.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'VERIFY_OTP',
          entity: 'OtpRequest',
          entityId: otpRequest.id,
          metadata: {
            success: false,
            remainingAttempts: otpRequest.maxAttempts - otpRequest.attempts - 1,
          },
          ipAddress: req?.ip,
          userAgent: req?.headers['user-agent'],
        },
      });

      const remaining = otpRequest.maxAttempts - otpRequest.attempts - 1;
      throw new BadRequestException(
        `Code invalide. Il vous reste ${remaining} tentative${remaining > 1 ? 's' : ''}.`,
      );
    }

    // Valider l'OTP
    const now = new Date();
    await this.prisma.otpRequest.update({
      where: { id: otpRequest.id },
      data: { status: OtpStatus.VERIFIED, verifiedAt: now },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'VERIFY_OTP',
        entity: 'OtpRequest',
        entityId: otpRequest.id,
        metadata: { success: true },
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    // Générer un token temporaire pour le reset (valable 5 min, signé)
    const resetToken = this.createToken(
      user.id,
      email,
      [],
      300, // 5 minutes
    );

    return {
      message: 'Code vérifié avec succès.',
      resetToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto, req?: Request) {
    this.assertPasswordAuthenticationEnabled();
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('Email non valide');
    }

    // Vérifier que l'OTP est bien en statut VERIFIED
    const resetPayload = this.verifyResetToken(req, email);
    if (resetPayload.sub !== user.id) {
      throw new UnauthorizedException('Session de réinitialisation invalide');
    }

    const otpRequest = await this.prisma.otpRequest.findFirst({
      where: {
        userId: user.id,
        type: OtpType.PASSWORD_RESET,
        status: OtpStatus.VERIFIED,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRequest) {
      throw new BadRequestException(
        "Veuillez d'abord vérifier votre code OTP.",
      );
    }

    if (new Date() > otpRequest.expiresAt) {
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { status: OtpStatus.EXPIRED },
      });
      throw new BadRequestException(
        'Le code a expiré. Veuillez en demander un nouveau.',
      );
    }

    // Vérifier que le code correspond (sécurité supplémentaire)
    if (!this.verifyOtpCode(dto.code.trim(), otpRequest.code)) {
      throw new BadRequestException('Code invalide.');
    }

    // Hasher et mettre à jour le mot de passe
    const passwordHash = this.hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await transaction.otpRequest.update({
        where: { id: otpRequest.id },
        data: { status: OtpStatus.EXPIRED },
      });

      // Audit log
      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: 'RESET_PASSWORD',
          entity: 'User',
          entityId: user.id,
          ipAddress: req?.ip,
          userAgent: req?.headers['user-agent'],
        },
      });
    });

    return { message: 'Mot de passe réinitialisé avec succès.' };
  }

  async getProfile(userId?: string, userEmail?: string) {
    const id = userId?.trim();
    const email = userEmail?.trim().toLowerCase();

    if (!id && !email) {
      throw new BadRequestException('Identifiant utilisateur requis');
    }

    if (email === ADMIN_EMAIL || id === 'admin-upowa') {
      return {
        id: 'admin-upowa',
        matricule: 'ADMIN',
        email: ADMIN_EMAIL,
        name: 'Admin Upowa',
        poste: 'Administrateur système',
        department: null,
        departmentHead: null,
        hierarchy: {
          n1: null,
          n2: null,
          n3: null,
        },
      };
    }

    const where = id ? { id } : { email: email! };
    const user = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        matricule: true,
        nom: true,
        prenom: true,
        email: true,
        poste: true,
        status: true,
        department: {
          select: {
            id: true,
            code: true,
            name: true,
            manager: {
              select: {
                id: true,
                nom: true,
                prenom: true,
                email: true,
                poste: true,
              },
            },
          },
        },
        n1: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            poste: true,
          },
        },
        n2: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            poste: true,
          },
        },
        n3: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            poste: true,
          },
        },
      },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return {
      id: user.id,
      matricule: user.matricule,
      email: user.email,
      name: this.fullName(user),
      poste: user.poste,
      department: user.department
        ? {
            id: user.department.id,
            code: user.department.code,
            name: user.department.name,
          }
        : null,
      departmentHead: user.department?.manager
        ? {
            id: user.department.manager.id,
            name: this.fullName(user.department.manager),
            email: user.department.manager.email,
            poste: user.department.manager.poste,
          }
        : null,
      hierarchy: {
        n1: user.n1
          ? {
              id: user.n1.id,
              name: this.fullName(user.n1),
              email: user.n1.email,
              poste: user.n1.poste,
            }
          : null,
        n2: user.n2
          ? {
              id: user.n2.id,
              name: this.fullName(user.n2),
              email: user.n2.email,
              poste: user.n2.poste,
            }
          : null,
        n3: user.n3
          ? {
              id: user.n3.id,
              name: this.fullName(user.n3),
              email: user.n3.email,
              poste: user.n3.poste,
            }
          : null,
      },
    };
  }

  private async createSessionForEmail(
    email: string,
    authenticationMethod: AuthenticationMethod,
    password?: string,
  ) {
    if (email === ADMIN_EMAIL) {
      if (authenticationMethod === 'google') {
        return this.toAdminSession();
      }

      if (!password) {
        throw new UnauthorizedException('Mot de passe requis');
      }
      const expectedHash = this.getAdminPasswordHash();
      if (!this.verifyPassword(password, expectedHash)) {
        throw new UnauthorizedException('Mot de passe invalide');
      }
      return this.toAdminSession();
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        matricule: true,
        nom: true,
        prenom: true,
        email: true,
        poste: true,
        status: true,
        passwordHash: true,
        department: { select: { id: true, code: true, name: true } },
        roles: { select: { role: true } },
      },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('Email non autorisé');
    }

    if (authenticationMethod === 'password') {
      if (user.passwordHash) {
        if (!password) {
          throw new UnauthorizedException('Mot de passe requis');
        }

        if (!this.verifyPassword(password, user.passwordHash)) {
          throw new UnauthorizedException('Mot de passe invalide');
        }
      } else if (password) {
        throw new UnauthorizedException(
          'Mot de passe non défini. Veuillez créer votre mot de passe avant de vous connecter.',
        );
      }
    }

    const explicitRoles = this.toAppRoles(user.roles.map((role) => role.role));
    const managedDepartments = await this.prisma.department.count({
      where: { managerId: user.id },
    });
    const roles =
      managedDepartments > 0 && !explicitRoles.includes('manager')
        ? [...explicitRoles, 'manager' as const]
        : explicitRoles;
    const primaryRole = this.pickPrimaryRole(roles);

    return {
      id: user.id,
      matricule: user.matricule,
      email: user.email,
      name: this.fullName(user),
      poste: user.poste,
      department: user.department,
      roles,
      primaryRole,
      homePath: this.getHomePath(primaryRole),
      token: this.createToken(user.id, user.email, roles),
      expiresAt: this.toExpiryIso(),
    };
  }

  private toAdminSession() {
    return {
      id: 'admin-upowa',
      matricule: 'ADMIN',
      email: ADMIN_EMAIL,
      name: 'Admin Upowa',
      poste: 'Administrateur système',
      department: null,
      roles: ['admin'] satisfies AppRole[],
      primaryRole: 'admin' satisfies AppRole,
      homePath: this.getHomePath('admin'),
      token: this.createToken('admin-upowa', ADMIN_EMAIL, ['admin']),
      expiresAt: this.toExpiryIso(),
    };
  }

  private getAdminPasswordHash() {
    const configuredHash = this.configService
      .get<string>('AUTH_ADMIN_PASSWORD_HASH')
      ?.trim();
    if (configuredHash) return configuredHash;

    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'AUTH_ADMIN_PASSWORD_HASH est requis en production',
      );
    }

    return DEV_ADMIN_PASSWORD_HASH;
  }

  private assertPasswordAuthenticationEnabled() {
    if (!this.isGoogleOnlyAuthentication()) return;

    throw new ForbiddenException(
      'Cette fonctionnalité est désactivée. Utilisez la connexion Google.',
    );
  }

  private isGoogleOnlyAuthentication() {
    const value = this.configService
      .get<string>('AUTH_GOOGLE_ONLY')
      ?.trim()
      .toLowerCase();

    return (
      value === 'true' || value === '1' || value === 'yes' || value === 'on'
    );
  }

  private getAuditUserId(userId: string) {
    return userId === 'admin-upowa' ? null : userId;
  }

  private createToken(
    sub: string,
    email: string,
    roles: AppRole[],
    customTtlSeconds?: number,
  ) {
    try {
      return createSessionToken(
        {
          sub,
          email,
          roles,
          ttlSeconds: customTtlSeconds ?? this.getSessionTtlSeconds(),
        },
        resolveSessionSecret(
          this.configService.get<string>('AUTH_SESSION_SECRET'),
        ),
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Configuration auth invalide',
      );
    }
  }

  private verifyResetToken(req: Request | undefined, email: string) {
    const token = this.getBearerToken(req);
    if (!token) {
      throw new UnauthorizedException('Session de réinitialisation expirée');
    }

    try {
      const result = verifySessionToken(
        token,
        resolveSessionSecret(
          this.configService.get<string>('AUTH_SESSION_SECRET'),
        ),
      );

      if (!result.valid) {
        throw new UnauthorizedException('Session de réinitialisation expirée');
      }

      if (result.payload.email !== email || result.payload.roles.length !== 0) {
        throw new UnauthorizedException('Session de réinitialisation invalide');
      }

      return result.payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Configuration auth invalide',
      );
    }
  }

  private getBearerToken(req: Request | undefined) {
    const authorization = req?.headers.authorization;
    if (!authorization) return undefined;

    const [type, token] = authorization.split(' ');
    if (type?.toLowerCase() !== 'bearer') return undefined;

    return token?.trim();
  }

  private toExpiryIso() {
    return new Date(
      Date.now() + this.getSessionTtlSeconds() * 1000,
    ).toISOString();
  }

  private getSessionTtlSeconds() {
    const raw =
      this.configService.get<string>('AUTH_SESSION_TTL_HOURS') ?? '12';
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) return 12 * 60 * 60;
    return Math.floor(hours * 60 * 60);
  }

  private toAppRoles(roles: RoleType[]): AppRole[] {
    const roleMap: Record<RoleType, AppRole> = {
      [RoleType.ADMIN]: 'admin',
      [RoleType.RH]: 'rh',
      [RoleType.MANAGER]: 'manager',
      [RoleType.EMPLOYE]: 'employee',
    };
    const mappedRoles = roles.map((role) => roleMap[role]);

    return mappedRoles.length ? [...new Set(mappedRoles)] : ['employee'];
  }

  private pickPrimaryRole(roles: AppRole[]) {
    const priority: AppRole[] = ['admin', 'rh', 'manager', 'employee'];

    return priority.find((role) => roles.includes(role)) ?? 'employee';
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, storedHash: string) {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    const comparisonHash = scryptSync(password, salt, 64);
    const expectedHash = Buffer.from(originalHash, 'hex');
    if (expectedHash.length !== comparisonHash.length) return false;

    return timingSafeEqual(expectedHash, comparisonHash);
  }

  private hashOtp(code: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(code, salt, 64).toString('hex');
    return `otp:v2:${salt}:${hash}`;
  }

  private verifyOtpCode(code: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    const [prefix, versionOrHash, salt, hash] = parts;
    if (prefix !== 'otp') return false;

    if (versionOrHash === 'v2' && parts.length === 4 && salt && hash) {
      return this.verifyScryptHash(code, salt, hash);
    }

    if (parts.length === 2) {
      return this.verifyScryptHash(code, 'otp-salt-static', versionOrHash);
    }

    return false;
  }

  private verifyScryptHash(value: string, salt: string, originalHash: string) {
    if (!originalHash) return false;

    const hash = scryptSync(value, salt, 64).toString('hex');
    const expectedHash = Buffer.from(originalHash, 'hex');
    const comparisonHash = Buffer.from(hash, 'hex');

    if (expectedHash.length !== comparisonHash.length) return false;
    return timingSafeEqual(expectedHash, comparisonHash);
  }

  private getHomePath(role: AppRole) {
    const paths: Record<AppRole, string> = {
      admin: '/admin/users',
      rh: '/rh',
      manager: '/manager',
      employee: '/',
    };

    return paths[role];
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }
}
