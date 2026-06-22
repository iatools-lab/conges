import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LeaveCategory, RoleType, Sexe } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createSessionToken } from '../src/common/auth/session-token';
import { PrismaService } from '../src/prisma/prisma.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;
const sessionSecret = 'e2e-session-secret-with-more-than-32-characters';
const testYear = new Date().getUTCFullYear() + 1;
const firstJuly = new Date(Date.UTC(testYear, 6, 1));
const daysUntilMonday = (8 - firstJuly.getUTCDay()) % 7;
const startDate = new Date(firstJuly);
startDate.setUTCDate(firstJuly.getUTCDate() + daysUntilMonday);
const endDate = new Date(startDate);
endDate.setUTCDate(startDate.getUTCDate() + 4);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

describeDatabase('Leave workflow with PostgreSQL (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let employeeId: string;
  let managerId: string;
  let rhId: string;
  let departmentId: string;
  let leaveTypeId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_SESSION_SECRET = sessionSecret;
    process.env.EMAIL_MODE = 'off';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();
    prisma = app.get(PrismaService);

    const department = await prisma.department.create({
      data: { code: 'E2E', name: 'Equipe E2E' },
    });
    departmentId = department.id;

    const manager = await prisma.user.create({
      data: {
        matricule: 'E2E-MGR',
        nom: 'Manager',
        prenom: 'E2E',
        sexe: Sexe.M,
        email: 'manager@e2e.local',
        poste: 'Manager E2E',
        dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
        departmentId,
        roles: { create: { role: RoleType.MANAGER } },
      },
    });
    managerId = manager.id;

    const rh = await prisma.user.create({
      data: {
        matricule: 'E2E-RH',
        nom: 'RH',
        prenom: 'E2E',
        sexe: Sexe.F,
        email: 'rh@e2e.local',
        poste: 'RH E2E',
        dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
        departmentId,
        roles: { create: { role: RoleType.RH } },
      },
    });
    rhId = rh.id;

    const employee = await prisma.user.create({
      data: {
        matricule: 'E2E-EMP',
        nom: 'Employe',
        prenom: 'E2E',
        sexe: Sexe.M,
        email: 'employee@e2e.local',
        poste: 'Employé E2E',
        dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
        departmentId,
        n1Id: managerId,
        roles: { create: { role: RoleType.EMPLOYE } },
      },
    });
    employeeId = employee.id;

    const leaveType = await prisma.leaveType.create({
      data: {
        code: 'E2E-CP',
        name: 'Congé E2E avec justificatif',
        category: LeaveCategory.CONGE_PAYE,
        defaultDays: 20,
        requiresProof: true,
      },
    });
    leaveTypeId = leaveType.id;
    await prisma.leaveBalance.create({
      data: {
        userId: employeeId,
        leaveTypeId,
        year: testYear,
        acquired: 20,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.leaveRequest.deleteMany({ where: { ownerId: employeeId } });
      await prisma.user.deleteMany({
        where: { email: { endsWith: '@e2e.local' } },
      });
      await prisma.leaveType.deleteMany({ where: { id: leaveTypeId } });
      await prisma.department.deleteMany({ where: { id: departmentId } });
    }
    await app?.close();
  });

  it('rejects login without a password and blocks RH from admin APIs', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'employee@e2e.local' })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/admin/roles')
      .set('Authorization', `Bearer ${token(rhId, 'rh@e2e.local', ['rh'])}`)
      .expect(403);
  });

  it('requires proof and processes repeated Manager/RH decisions once', async () => {
    const employeeToken = token(employeeId, 'employee@e2e.local', ['employee']);
    const requestBody = {
      leaveTypeCode: 'E2E-CP',
      startDate: isoDate(startDate),
      endDate: isoDate(endDate),
      reason: 'Parcours E2E',
    };

    await request(app.getHttpServer())
      .post('/api/v1/employee/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .field(requestBody)
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/employee/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .field(requestBody)
      .attach('proof', Buffer.from('%PDF-1.4 e2e'), {
        filename: 'justificatif.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const createdBody = JSON.parse(created.text) as unknown;
    if (
      !createdBody ||
      typeof createdBody !== 'object' ||
      !('id' in createdBody) ||
      typeof createdBody.id !== 'string'
    ) {
      throw new Error('Réponse de création de demande invalide');
    }
    const leaveRequestId = createdBody.id;
    const managerToken = token(managerId, 'manager@e2e.local', ['manager']);
    await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .patch(`/api/v1/manager/requests/${leaveRequestId}/decision`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ decision: 'approve' })
          .expect(200),
      ),
    );

    const rhToken = token(rhId, 'rh@e2e.local', ['rh']);
    await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .patch(`/api/v1/rh/global-view/requests/${leaveRequestId}/decision`)
          .set('Authorization', `Bearer ${rhToken}`)
          .send({ decision: 'approve' })
          .expect(200),
      ),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/manager/requests/${leaveRequestId}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'approve' })
      .expect(200);

    const [storedRequest, validations, balance] = await Promise.all([
      prisma.leaveRequest.findUniqueOrThrow({
        where: { id: leaveRequestId },
        include: { attachments: true },
      }),
      prisma.validation.findMany({ where: { requestId: leaveRequestId } }),
      prisma.leaveBalance.findUniqueOrThrow({
        where: {
          userId_leaveTypeId_year: {
            userId: employeeId,
            leaveTypeId,
            year: testYear,
          },
        },
      }),
    ]);

    expect(storedRequest.status).toBe('APPROVED');
    expect(storedRequest.attachments).toHaveLength(1);
    expect(validations).toHaveLength(2);
    expect(balance.scheduled).toBe(5);
  });
});

function token(
  sub: string,
  email: string,
  roles: Array<'employee' | 'manager' | 'rh' | 'admin'>,
) {
  return createSessionToken(
    { sub, email, roles, ttlSeconds: 3600 },
    sessionSecret,
  );
}
