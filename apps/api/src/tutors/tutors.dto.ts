import { Prisma } from '@prisma/client';
import { z } from 'zod';

// ---- input (D4) ----
export const tutorProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    bio: z.string().trim().max(2000),
    experience: z.string().trim().max(2000),
    pricePerSessionVnd: z.number().int().min(1).max(100_000_000),
    subjectIds: z.array(z.number().int().positive()).min(1).max(10),
  })
  .strict();

const intParam = z.coerce.number().int();

export const searchTutorsSchema = z.object({
  subjectId: intParam.positive().optional(),
  minPrice: intParam.min(0).optional(),
  maxPrice: intParam.min(0).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  availableDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    .optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['rating_desc', 'price_asc', 'price_desc']).default('rating_desc'),
  page: intParam.min(1).max(100_000).default(1),
  pageSize: intParam.min(1).max(100).default(20),
});
export type SearchTutorsInput = z.infer<typeof searchTutorsSchema>;

export const uuidSchema = z.uuid();

// ---- output: role-specific allow-lists (A5) ----
export const tutorInclude = {
  user: { select: { fullName: true } },
  subjects: { include: { subject: true }, orderBy: { subjectId: 'asc' } },
} satisfies Prisma.TutorProfileInclude;

export type TutorRow = Prisma.TutorProfileGetPayload<{ include: typeof tutorInclude }>;

export interface TutorSummaryDto {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  subjects: { id: number; name: string; slug: string }[];
  pricePerSessionVnd: number;
  ratingAvg: number;
  ratingCount: number;
  nextAvailableAt: string | null;
}

export interface TutorPublicDto extends TutorSummaryDto {
  bio: string;
  experience: string;
}

export interface TutorOwnProfileDto extends Omit<TutorPublicDto, 'pricePerSessionVnd'> {
  /** null until the tutor has filled in the profile. */
  pricePerSessionVnd: number | null;
  approvalStatus: TutorRow['approvalStatus'];
  rejectionReason: string | null;
}

const base = (row: TutorRow, nextAvailableAt: Date | null) => ({
  id: row.userId,
  fullName: row.user.fullName,
  avatarUrl: row.avatarUrl,
  subjects: row.subjects.map((s) => ({ id: s.subject.id, name: s.subject.name, slug: s.subject.slug })),
  ratingAvg: Number(row.ratingAvg),
  ratingCount: row.ratingCount,
  nextAvailableAt: nextAvailableAt ? nextAvailableAt.toISOString() : null,
});

/** Public DTO: never carries email, approval status, rejection reason or reviewer (A5). */
export function toTutorSummary(row: TutorRow, nextAvailableAt: Date | null): TutorSummaryDto {
  return { ...base(row, nextAvailableAt), pricePerSessionVnd: row.pricePerSessionVnd ?? 0 };
}

export function toTutorPublic(row: TutorRow, nextAvailableAt: Date | null): TutorPublicDto {
  return { ...toTutorSummary(row, nextAvailableAt), bio: row.bio, experience: row.experience };
}

export function toTutorOwn(row: TutorRow): TutorOwnProfileDto {
  return {
    ...base(row, null),
    pricePerSessionVnd: row.pricePerSessionVnd,
    bio: row.bio,
    experience: row.experience,
    approvalStatus: row.approvalStatus,
    rejectionReason: row.rejectionReason,
  };
}
