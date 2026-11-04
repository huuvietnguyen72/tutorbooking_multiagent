import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const newPassword = z.string().min(8).max(128);

export const registerSchema = z
  .object({
    email,
    password: newPassword,
    fullName: z.string().trim().min(1).max(100),
    role: z.enum(['STUDENT', 'TUTOR']),
  })
  .strict();

export const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();

export const updateMeSchema = z.object({ fullName: z.string().trim().min(1).max(100) }).strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword })
  .strict();

export interface MeDto {
  id: string;
  email: string;
  fullName: string;
  role: 'STUDENT' | 'TUTOR' | 'ADMIN';
  status: 'ACTIVE' | 'LOCKED';
  mustChangePassword: boolean;
  tutorApprovalStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}
