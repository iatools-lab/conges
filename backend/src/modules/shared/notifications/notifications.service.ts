import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FindNotificationsQueryDto,
  NotificationOwnerDto,
} from './dto/notification.dto';

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  description: true,
  link: true,
  read: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type NotificationRecord = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindNotificationsQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const limit = query.limit ?? 10;
    const [notifications, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: notificationSelect,
      }),
      this.prisma.notification.count({
        where: { userId: user.id, read: false },
      }),
    ]);

    return {
      user: { id: user.id, email: user.email },
      unread,
      rows: notifications.map((notification) => this.toResponse(notification)),
    };
  }

  async markRead(id: string, dto: NotificationOwnerDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!notification) throw new NotFoundException('Notification introuvable');

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { read: true },
      select: notificationSelect,
    });

    return this.toResponse(updated);
  }

  async markAllRead(dto: NotificationOwnerDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });

    return { updated: result.count };
  }

  private async resolveUser(userId?: string, userEmail?: string) {
    const where = userId?.trim()
      ? { id: userId.trim() }
      : userEmail?.trim()
        ? { email: userEmail.trim().toLowerCase() }
        : null;

    if (!where) throw new BadRequestException('Utilisateur requis');

    const user = await this.prisma.user.findUnique({
      where,
      select: { id: true, email: true, status: true },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
  }

  private toResponse(notification: NotificationRecord) {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      description: notification.description,
      link: notification.link,
      read: notification.read,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
