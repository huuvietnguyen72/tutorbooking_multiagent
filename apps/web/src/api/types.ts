import type { components } from './schema';

type S = components['schemas'];

export type Me = S['Me'];
export type UserRole = S['UserRole'];
export type TutorApprovalStatus = S['TutorApprovalStatus'];
export type Subject = S['Subject'];
export type TutorSummary = S['TutorSummary'];
export type TutorPublic = S['TutorPublic'];
export type TutorSummaryPage = S['TutorSummaryPage'];
export type PublicSlot = S['PublicSlot'];
export type PublicReview = S['PublicReview'];
export type PublicReviewPage = S['PublicReviewPage'];
export type RegisterRequest = S['RegisterRequest'];
export type LoginRequest = S['LoginRequest'];
export type ErrorCode = S['ErrorCode'];
export type TutorSort = 'rating_desc' | 'price_asc' | 'price_desc';

export interface PublicConfig {
  cancellationWindowHours: number;
  holdMinutes: number;
  slotDurationMinutes: number;
  minBookingLeadMinutes: number;
  timezone: string;
  mockGatewayEnabled: boolean;
}

export interface TutorSearchParams {
  subjectId?: number;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  availableDate?: string;
  q?: string;
  sort?: TutorSort;
  page?: number;
  pageSize?: number;
}
