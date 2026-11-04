import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';
import { PrismaService } from '../common/prisma.service';
import type { MeDto } from './auth.dto';
import { PasswordService } from './password.service';

type UserWithProfile = Prisma.UserGetPayload<{ include: { tutorProfile: true } }>;

export function toMe(user: UserWithProfile): MeDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    ...(user.role === 'TUTOR' && user.tutorProfile
      ? { tutorApprovalStatus: user.tutorProfile.approvalStatus }
      : {}),
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    fullName: string;
    role: 'STUDENT' | 'TUTOR';
  }): Promise<MeDto> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: input.role,
          ...(input.role === 'TUTOR' ? { tutorProfile: { create: {} } } : {}),
        },
        include: { tutorProfile: true },
      });
      return toMe(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'EMAIL_TAKEN', 'Email is already registered');
      }
      throw error;
    }
  }

  /** Returns the user and bumps nothing; caller sets the cookie. */
  async login(email: string, password: string): Promise<{ me: MeDto; user: UserWithProfile }> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { tutorProfile: true } });
    if (!user) {
      await this.passwords.verifyDummy(password);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.status === 'LOCKED') {
      throw new AppError(403, 'ACCOUNT_LOCKED', 'Account is locked');
    }
    return { me: toMe(user), user };
  }

  /** Revokes every session of the user (logout = all devices, C1). */
  async revokeSessions(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  }

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tutorProfile: true },
    });
    return toMe(user);
  }

  async updateName(userId: string, fullName: string): Promise<MeDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { fullName },
      include: { tutorProfile: true },
    });
    return toMe(user);
  }

  /** Verifies the current password, rotates the hash and invalidates other sessions. Returns the new user row. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError(403, 'WRONG_CURRENT_PASSWORD', 'Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw AppError.validation([{ field: 'newPassword', code: 'same_as_current' }]);
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });
  }
}
