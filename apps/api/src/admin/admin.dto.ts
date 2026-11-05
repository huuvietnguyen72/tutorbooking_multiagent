import type { AuditLog, Payment, PaymentEvent, BookingHistory, Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { instant } from '../slots/slots.dto';
import { PaymentDto, StudentBookingDto, toPaymentDto } from '../bookings/bookings.dto';
import { toTutorOwn, TutorOwnProfileDto, tutorInclude } from '../tutors/tutors.dto';

// ---- input (D4) ----
const intParam = z.coerce.number().int();
const paging = {
  page: intParam.min(1).max(100_000).default(1),
  pageSize: intParam.min(1).max(100).default(20),
};
const search = z.string().trim().max(100).optional();

export const listUsersSchema = z.object({
  role: z.enum(['STUDENT', 'TUTOR', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'LOCKED']).optional(),
  q: search,
  ...paging,
});

export const userStatusSchema = z
  .object({ status: z.enum(['ACTIVE', 'LOCKED']), reason: z.string().trim().max(500).optional() })
  .strict();

export const listTutorsSchema = z.object({
  approvalStatus: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  q: search,
  ...paging,
});

/** `{action}` path segment: a closed enum, anything else is a 400 (A3). */
export const tutorActionSchema = z.enum(['approve', 'reject', 'suspend', 'reinstate']);
export type TutorAction = z.infer<typeof tutorActionSchema>;

export const tutorDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const listAdminBookingsSchema = z.object({
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_TUTOR', 'CANCELLED_BY_ADMIN']).optional(),
  tutorId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  from: instant.optional(),
  to: instant.optional(),
  /** Refunds that failed at the provider and wait for a manual retry (US-ADM-04 AC2). */
  refundFailed: z.enum(['true', 'false']).optional(),
  ...paging,
});

export const adminCancelSchema = z
  .object({ reason: z.string().trim().min(1).max(500), refund: z.boolean().default(true) })
  .strict();

export const listAuditSchema = z.object({
  entityType: z.string().trim().min(1).max(50).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  ...paging,
});

// ---- output: allow-lists, never `return entity` ----
export interface AdminUserDto {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  tutorApprovalStatus: string | null;
  createdAt: string;
}

export const adminUserInclude = { tutorProfile: { select: { approvalStatus: true } } } satisfies Prisma.UserInclude;
export type AdminUserRow = User & { tutorProfile: { approvalStatus: string } | null };

export const toAdminUser = (row: AdminUserRow): AdminUserDto => ({
  id: row.id,
  email: row.email,
  fullName: row.fullName,
  role: row.role,
  status: row.status,
  tutorApprovalStatus: row.tutorProfile?.approvalStatus ?? null,
  createdAt: row.createdAt.toISOString(),
});

export interface AdminTutorDto extends TutorOwnProfileDto {
  email: string;
  reviewedAt: string | null;
}

export const adminTutorInclude = {
  ...tutorInclude,
  user: { select: { fullName: true, email: true } },
} satisfies Prisma.TutorProfileInclude;
export type AdminTutorRow = Prisma.TutorProfileGetPayload<{ include: typeof adminTutorInclude }>;

export const toAdminTutor = (row: AdminTutorRow): AdminTutorDto => ({
  ...toTutorOwn(row),
  email: row.user.email,
  reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
});

export interface AdminPaymentDto extends PaymentDto {
  refundedByName: string | null;
}

export const toAdminPayment = (payment: Payment, refundedByName: string | null): AdminPaymentDto => ({
  ...toPaymentDto(payment),
  refundedByName,
});

export interface AdminBookingDto extends Omit<StudentBookingDto, 'payment'> {
  payment: AdminPaymentDto;
}

export interface AdminBookingDetailDto extends AdminBookingDto {
  studentEmail: string;
  tutorEmail: string;
  history: {
    fromStatus: string | null;
    toStatus: string;
    fromSlotId: string | null;
    toSlotId: string | null;
    actorType: string;
    actorId: string | null;
    note: string | null;
    createdAt: string;
  }[];
  paymentEvents: { eventId: string; outcome: string; rejectedReason: string | null; receivedAt: string }[];
}

export const toHistoryEntry = (h: BookingHistory) => ({
  fromStatus: h.fromStatus,
  toStatus: h.toStatus,
  fromSlotId: h.fromSlotId,
  toSlotId: h.toSlotId,
  actorType: h.actorType,
  actorId: h.actorId,
  note: h.note,
  createdAt: h.createdAt.toISOString(),
});

export const toPaymentEventEntry = (e: PaymentEvent) => ({
  eventId: e.eventId,
  outcome: e.outcome,
  rejectedReason: e.rejectedReason,
  receivedAt: e.receivedAt.toISOString(),
});

export interface AuditLogDto {
  id: number;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  createdAt: string;
}

export const toAuditLog = (row: AuditLog): AuditLogDto => ({
  id: Number(row.id),
  actorId: row.actorId,
  action: row.action,
  entityType: row.entityType,
  entityId: row.entityId,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
});
