import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { toTutorOwn, TutorOwnProfileDto, tutorInclude } from './tutors.dto';

type ProfileInput = {
  fullName: string;
  bio: string;
  experience: string;
  pricePerSessionVnd: number;
  subjectIds: number[];
};

@Injectable()
export class TutorProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async get(userId: string): Promise<TutorOwnProfileDto> {
    const row = await this.prisma.tutorProfile.findUnique({ where: { userId }, include: tutorInclude });
    if (!row) throw AppError.notFound();
    return toTutorOwn(row);
  }

  /** Does not touch approvalStatus (A5): editing never re-triggers or bypasses review. */
  async update(userId: string, input: ProfileInput): Promise<TutorOwnProfileDto> {
    const subjectIds = [...new Set(input.subjectIds)];
    const known = await this.prisma.subject.count({ where: { id: { in: subjectIds } } });
    if (known !== subjectIds.length) throw AppError.validation([{ field: 'subjectIds', code: 'unknown_subject' }]);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { fullName: input.fullName } }),
      this.prisma.tutorProfile.update({
        where: { userId },
        data: { bio: input.bio, experience: input.experience, pricePerSessionVnd: input.pricePerSessionVnd },
      }),
      this.prisma.tutorSubject.deleteMany({ where: { tutorId: userId } }),
      this.prisma.tutorSubject.createMany({ data: subjectIds.map((subjectId) => ({ tutorId: userId, subjectId })) }),
    ]);
    return this.get(userId);
  }

  async setAvatar(userId: string, data: Buffer): Promise<TutorOwnProfileDto> {
    const name = await this.storage.saveAvatar(data);
    const previous = await this.prisma.tutorProfile.findUniqueOrThrow({ where: { userId }, select: { avatarUrl: true } });
    try {
      await this.prisma.tutorProfile.update({ where: { userId }, data: { avatarUrl: StorageService.urlFor(name) } });
    } catch (error) {
      await this.storage.deleteAvatar(name);
      throw error;
    }
    const old = StorageService.nameFromUrl(previous.avatarUrl);
    if (old) await this.storage.deleteAvatar(old);
    return this.get(userId);
  }

  /** REJECTED -> PENDING_APPROVAL; any other state is a 409. */
  async resubmit(userId: string): Promise<TutorOwnProfileDto> {
    const result = await this.prisma.tutorProfile.updateMany({
      where: { userId, approvalStatus: 'REJECTED' },
      data: { approvalStatus: 'PENDING_APPROVAL', rejectionReason: null, reviewedBy: null, reviewedAt: null },
    });
    if (result.count === 0) throw new AppError(409, 'INVALID_STATE', 'Profile is not in a rejected state');
    return this.get(userId);
  }
}
