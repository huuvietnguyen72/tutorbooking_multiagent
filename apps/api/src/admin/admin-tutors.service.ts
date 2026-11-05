import { Injectable } from '@nestjs/common';
import { Prisma, TutorApprovalStatus } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { Page } from '../bookings/bookings.service';
import { adminTutorInclude, AdminTutorDto, toAdminTutor, TutorAction } from './admin.dto';

interface Transition {
  from: TutorApprovalStatus;
  to: TutorApprovalStatus;
  audit: string;
  reasonRequired?: boolean;
}

const TRANSITIONS: Record<TutorAction, Transition> = {
  approve: { from: 'PENDING_APPROVAL', to: 'APPROVED', audit: 'TUTOR_APPROVED' },
  reject: { from: 'PENDING_APPROVAL', to: 'REJECTED', audit: 'TUTOR_REJECTED', reasonRequired: true },
  suspend: { from: 'APPROVED', to: 'SUSPENDED', audit: 'TUTOR_SUSPENDED' },
  reinstate: { from: 'SUSPENDED', to: 'APPROVED', audit: 'TUTOR_REINSTATED' },
};

@Injectable()
export class AdminTutorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(filter: { approvalStatus?: TutorApprovalStatus; q?: string }, page: number, pageSize: number): Promise<Page<AdminTutorDto>> {
    const where: Prisma.TutorProfileWhereInput = {
      ...(filter.approvalStatus ? { approvalStatus: filter.approvalStatus } : {}),
      ...(filter.q
        ? {
            user: {
              OR: [{ email: { contains: filter.q, mode: 'insensitive' } }, { fullName: { contains: filter.q, mode: 'insensitive' } }],
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tutorProfile.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: adminTutorInclude,
      }),
      this.prisma.tutorProfile.count({ where }),
    ]);
    return { items: rows.map(toAdminTutor), page, pageSize, total };
  }

  /** Approve / reject / suspend / reinstate (US-ADM-01). Existing bookings are left alone. */
  async decide(adminId: string, tutorId: string, action: TutorAction, reason?: string): Promise<AdminTutorDto> {
    const rule = TRANSITIONS[action];
    if (rule.reasonRequired && !reason) throw AppError.validation([{ field: 'reason', code: 'required' }]);

    return this.prisma.$transaction(async (tx) => {
      // A non-TUTOR user has no profile row: same 404 as an unknown id.
      await tx.$queryRaw`SELECT user_id FROM tutor_profiles WHERE user_id = ${tutorId}::uuid FOR UPDATE`;
      const profile = await tx.tutorProfile.findUnique({ where: { userId: tutorId } });
      if (!profile) throw AppError.notFound();
      if (profile.approvalStatus !== rule.from) {
        throw new AppError(409, 'INVALID_STATE', 'Tutor is not in a state that allows this action', { current: profile.approvalStatus });
      }
      if (action === 'approve' && !profile.pricePerSessionVnd) {
        throw new AppError(409, 'INVALID_STATE', 'Tutor profile has no price yet', { current: profile.approvalStatus });
      }
      const row = await tx.tutorProfile.update({
        where: { userId: tutorId },
        data: {
          approvalStatus: rule.to,
          rejectionReason: action === 'reject' ? reason : null,
          reviewedBy: adminId,
          reviewedAt: this.clock.now(),
        },
        include: adminTutorInclude,
      });
      await recordAudit(tx, {
        actorId: adminId,
        action: rule.audit,
        entityType: 'tutor',
        entityId: tutorId,
        reason: reason ?? null,
        metadata: { from: rule.from, to: rule.to },
      });
      return toAdminTutor(row);
    });
  }
}
