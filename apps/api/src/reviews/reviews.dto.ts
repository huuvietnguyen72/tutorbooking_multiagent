import type { Review } from '@prisma/client';
import { z } from 'zod';

// ---- input (D4) ----
export const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

export const hideReviewSchema = z.object({ hidden: z.boolean() }).strict();

// ---- output: allow-list mappers (A2) ----
/** "Nguyễn Văn An" -> "Nguyễn A."; the public never sees a full student name. */
export function abbreviateName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  const given = Array.from(words[words.length - 1])[0];
  return `${words[0]} ${given.toUpperCase()}.`;
}

/** Public/tutor view: no bookingId, no hidden flag. */
export interface PublicReviewDto {
  id: string;
  studentName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

/** Student/admin view of one review. */
export interface ReviewDto {
  id: string;
  bookingId: string;
  studentName: string;
  rating: number;
  comment: string | null;
  hidden: boolean;
  createdAt: string;
}

type WithStudent = Review & { student: { fullName: string } };

export const toPublicReview = (row: WithStudent): PublicReviewDto => ({
  id: row.id,
  studentName: abbreviateName(row.student.fullName),
  rating: row.rating,
  comment: row.comment,
  createdAt: row.createdAt.toISOString(),
});

export const toReview = (row: WithStudent): ReviewDto => ({
  id: row.id,
  bookingId: row.bookingId,
  studentName: abbreviateName(row.student.fullName),
  rating: row.rating,
  comment: row.comment,
  hidden: row.isHidden,
  createdAt: row.createdAt.toISOString(),
});
