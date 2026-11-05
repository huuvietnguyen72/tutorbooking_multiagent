import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import { AppError } from '../common/app-error';
import { PrismaService } from '../common/prisma.service';
import { Page } from '../bookings/bookings.service';
import { adminUserInclude, AdminUserDto, toAdminUser } from './admin.dto';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: { role?: string; status?: string; q?: string }, page: number, pageSize: number): Promise<Page<AdminUserDto>> {
    const where: Prisma.UserWhereInput = {
      ...(filter.role ? { role: filter.role as never } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.q
        ? { OR: [{ email: { contains: filter.q, mode: 'insensitive' } }, { fullName: { contains: filter.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: adminUserInclude,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(toAdminUser), page, pageSize, total };
  }

  /**
   * Lock/unlock a student or tutor (US-ADM-02). Locking bumps `token_version`, which kills every
   * live session at the next request. Admin accounts, including the caller's own, are untouchable.
   */
  async setStatus(adminId: string, userId: string, status: 'ACTIVE' | 'LOCKED', reason?: string): Promise<AdminUserDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, include: adminUserInclude });
      if (!user) throw AppError.notFound();
      if (user.role === 'ADMIN') throw new AppError(409, 'CANNOT_LOCK_ADMIN', 'Admin accounts cannot be locked');
      if (user.status === status) return toAdminUser(user); // already there: nothing to change, nothing to audit

      const next = await tx.user.update({
        where: { id: userId },
        data: status === 'LOCKED' ? { status, tokenVersion: { increment: 1 } } : { status },
        include: adminUserInclude,
      });
      await recordAudit(tx, {
        actorId: adminId,
        action: status === 'LOCKED' ? 'USER_LOCKED' : 'USER_UNLOCKED',
        entityType: 'user',
        entityId: userId,
        reason: reason ?? null,
        metadata: { role: user.role },
      });
      return toAdminUser(next);
    });
  }
}
