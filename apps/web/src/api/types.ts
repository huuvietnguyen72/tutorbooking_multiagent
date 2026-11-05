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
export type TutorOwnProfile = S['TutorOwnProfile'];
export type TutorProfileInput = S['TutorProfileInput'];
export type TutorSlot = S['TutorSlot'];
export type SlotStatus = S['SlotStatus'];
export type BookingStatus = S['BookingStatus'];
export type TutorBooking = S['TutorBooking'];
export type TutorBookingPage = S['TutorBookingPage'];
export type UserStatus = S['UserStatus'];
export type PaymentStatus = S['PaymentStatus'];
export type Payment = S['Payment'];
export type Booking = S['Booking'];
export type BookingPage = S['BookingPage'];
export type AdminUser = S['AdminUser'];
export type AdminUserPage = S['AdminUserPage'];
export type AdminTutor = S['AdminTutor'];
export type AdminTutorPage = S['AdminTutorPage'];
export type AdminBookingDetail = S['AdminBookingDetail'];
export type AuditLog = S['AuditLog'];
export type AuditLogPage = S['AuditLogPage'];
export type TutorAction = 'approve' | 'reject' | 'suspend' | 'reinstate';
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

export type TeachingScope = 'upcoming' | 'past' | 'cancelled';

export interface AdminStats {
  pendingTutors: number;
  bookingsToday: number;
  confirmedUpcoming: number;
  refundsFailed: number;
}

export interface AdminUserParams {
  role?: UserRole;
  status?: UserStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminTutorParams {
  approvalStatus?: TutorApprovalStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminBookingParams {
  status?: BookingStatus;
  tutorId?: string;
  studentId?: string;
  from?: string;
  to?: string;
  refundFailed?: 'true';
  page?: number;
  pageSize?: number;
}

export interface AuditLogParams {
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}
