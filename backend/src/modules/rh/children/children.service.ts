import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventType, Prisma, Sexe, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRhChildDto, UpdateRhChildDto } from './dto/rh-child.dto';

const CHILD_BONUS_DAYS = 2;
const CHILD_BONUS_MAX_AGE = 6;

const childSelect = {
  id: true,
  parentId: true,
  nom: true,
  prenom: true,
  dateNaissance: true,
  sexe: true,
  parent: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      sexe: true,
      status: true,
      department: { select: { name: true } },
    },
  },
} satisfies Prisma.ChildSelect;

type ChildRecord = Prisma.ChildGetPayload<{ select: typeof childSelect }>;
type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RhChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const children = await this.prisma.child.findMany({
      orderBy: [
        { parent: { nom: 'asc' } },
        { parent: { prenom: 'asc' } },
        { dateNaissance: 'desc' },
      ],
      select: childSelect,
    });

    return children.map((child) => this.toResponse(child));
  }

  async create(dto: CreateRhChildDto) {
    const dateNaissance = this.parseBirthDate(dto.dateNaissance);

    return this.prisma.$transaction(async (transaction) => {
      await this.ensureParent(transaction, dto.parentId);

      const child = await transaction.child.create({
        data: {
          parentId: dto.parentId,
          nom: this.normalizeName(dto.nom, true),
          prenom: this.normalizeName(dto.prenom),
          dateNaissance,
          sexe: dto.sexe,
        },
        select: childSelect,
      });

      await this.upsertProcessedBirthEvent(transaction, child);

      return this.toResponse(child);
    });
  }

  async update(id: string, dto: UpdateRhChildDto) {
    const existing = await this.prisma.child.findUnique({
      where: { id },
      select: { id: true, parentId: true },
    });
    if (!existing) throw new NotFoundException('Enfant introuvable');

    return this.prisma.$transaction(async (transaction) => {
      const data: Prisma.ChildUpdateInput = {};

      if (dto.parentId !== undefined) {
        await this.ensureParent(transaction, dto.parentId);
        data.parent = { connect: { id: dto.parentId } };
      }
      if (dto.nom !== undefined) data.nom = this.normalizeName(dto.nom, true);
      if (dto.prenom !== undefined)
        data.prenom = this.normalizeName(dto.prenom);
      if (dto.dateNaissance !== undefined)
        data.dateNaissance = this.parseBirthDate(dto.dateNaissance);
      if (dto.sexe !== undefined) data.sexe = dto.sexe;

      const child = await transaction.child.update({
        where: { id },
        data,
        select: childSelect,
      });

      await this.upsertProcessedBirthEvent(transaction, child);

      return this.toResponse(child);
    });
  }

  async remove(id: string) {
    const child = await this.prisma.child.findUnique({
      where: { id },
      select: childSelect,
    });
    if (!child) throw new NotFoundException('Enfant introuvable');

    await this.prisma.$transaction(async (transaction) => {
      await transaction.event.deleteMany({
        where: {
          type: EventType.BIRTH,
          description: { startsWith: this.eventDescriptionPrefix(id) },
        },
      });
      await transaction.child.delete({ where: { id } });
    });

    return this.toResponse(child);
  }

  private async ensureParent(client: PrismaClientLike, parentId: string) {
    const parent = await client.user.findUnique({
      where: { id: parentId },
      select: { id: true, status: true },
    });
    if (!parent) throw new NotFoundException('Employé parent introuvable');
    if (parent.status === UserStatus.INACTIVE) {
      throw new BadRequestException(
        'Impossible de rattacher un enfant à un employé inactif',
      );
    }
  }

  private async upsertProcessedBirthEvent(
    client: PrismaClientLike,
    child: ChildRecord,
  ) {
    const description = `${this.eventDescriptionPrefix(child.id)} ${child.prenom} ${child.nom}`;
    const existingEvent = await client.event.findFirst({
      where: {
        type: EventType.BIRTH,
        description: { startsWith: this.eventDescriptionPrefix(child.id) },
      },
      select: { id: true },
    });

    if (existingEvent) {
      await client.event.update({
        where: { id: existingEvent.id },
        data: {
          userId: child.parentId,
          eventDate: child.dateNaissance,
          description,
          processed: true,
        },
      });
      return;
    }

    await client.event.create({
      data: {
        userId: child.parentId,
        type: EventType.BIRTH,
        eventDate: child.dateNaissance,
        description,
        processed: true,
      },
    });
  }

  private toResponse(child: ChildRecord) {
    const ageYears = this.getCompletedYears(child.dateNaissance, new Date());
    const eligibleUntil = this.getEligibilityEndDate(child.dateNaissance);
    const isUnderMaxAge = eligibleUntil > new Date();
    const parentEligibleForChildBonus = child.parent.sexe === Sexe.F;
    const bonusDays =
      parentEligibleForChildBonus && isUnderMaxAge ? CHILD_BONUS_DAYS : 0;
    const status = isUnderMaxAge ? 'valid' : 'expired';

    return {
      id: child.id,
      parentId: child.parentId,
      parentName: `${child.parent.prenom} ${child.parent.nom}`.trim(),
      parentMatricule: child.parent.matricule,
      department: child.parent.department?.name ?? '',
      nom: child.nom,
      prenom: child.prenom,
      childName: `${child.prenom} ${child.nom}`.trim(),
      dateNaissance: child.dateNaissance.toISOString().slice(0, 10),
      sexe: child.sexe,
      ageYears,
      ageLabel: `${ageYears} ${ageYears > 1 ? 'ans' : 'an'}`,
      bonusDays,
      bonusLabel: bonusDays ? `+${bonusDays}` : '0',
      eligibleUntil: eligibleUntil.toISOString().slice(0, 10),
      status,
      statusLabel: this.getStatusLabel(status),
    };
  }

  private getStatusLabel(status: string) {
    if (status === 'valid') return 'Validé';
    if (status === 'expired') return 'Expiré';
    return 'Validé';
  }

  private getEligibilityEndDate(dateNaissance: Date) {
    return new Date(
      Date.UTC(
        dateNaissance.getUTCFullYear() + CHILD_BONUS_MAX_AGE,
        dateNaissance.getUTCMonth(),
        dateNaissance.getUTCDate(),
      ),
    );
  }

  private getCompletedYears(startDate: Date, referenceDate: Date) {
    let years = referenceDate.getUTCFullYear() - startDate.getUTCFullYear();
    const beforeBirthday =
      referenceDate.getUTCMonth() < startDate.getUTCMonth() ||
      (referenceDate.getUTCMonth() === startDate.getUTCMonth() &&
        referenceDate.getUTCDate() < startDate.getUTCDate());

    if (beforeBirthday) years -= 1;

    return Math.max(years, 0);
  }

  private parseBirthDate(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date de naissance invalide');
    }
    if (date > new Date()) {
      throw new BadRequestException(
        'La date de naissance ne peut pas être future',
      );
    }

    return date;
  }

  private normalizeName(value: string, uppercase = false) {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException('Nom ou prénom requis');
    return uppercase ? normalized.toUpperCase() : normalized;
  }

  private eventDescriptionPrefix(childId: string) {
    return `Enfant RH ${childId}:`;
  }
}
