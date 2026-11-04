import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AppError } from '../common/app-error';
import { AllowMultipart, AuthUser, CurrentUser, Public, RateLimit, Roles } from '../common/decorators';
import { MAX_AVATAR_BYTES, StorageService } from '../common/storage.service';
import { parse } from '../common/zod';
import { PublicSlotsService } from '../slots/public-slots.service';
import { PublicSlotDto, rangeSchema } from '../slots/slots.dto';
import { PublicTutorsService } from './public-tutors.service';
import { TutorProfileService } from './tutor-profile.service';
import { searchTutorsSchema, tutorProfileSchema, uuidSchema } from './tutors.dto';

const id = (value: string): string => {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw AppError.validation([{ field: 'id', code: 'invalid_uuid' }]); // D4
  return result.data;
};

@Controller()
export class PublicTutorsController {
  constructor(
    private readonly tutors: PublicTutorsService,
    private readonly slots: PublicSlotsService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('tutors')
  search(@Query() query: unknown) {
    return this.tutors.search(parse(searchTutorsSchema, query));
  }

  @Public()
  @Get('tutors/:tutorId')
  get(@Param('tutorId') tutorId: string) {
    return this.tutors.get(id(tutorId));
  }

  @Public()
  @Get('tutors/:tutorId/slots')
  slotsOf(@Param('tutorId') tutorId: string, @Query() query: unknown): Promise<PublicSlotDto[]> {
    const range = parse(rangeSchema, query);
    return this.slots.listForTutor(id(tutorId), range.from, range.to);
  }

  @Public()
  @Get('slots/:slotId')
  slot(@Param('slotId') slotId: string) {
    return this.slots.get(id(slotId));
  }

  /** Avatars are only served from the whitelisted random names this API generated (D2). */
  @Public()
  @Get('files/avatars/:name')
  avatar(@Param('name') name: string, @Res() res: Response): void {
    const path = this.storage.avatarPath(name);
    if (!path) throw AppError.notFound();
    res.type(name.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(path, (error) => {
      if (error && !res.headersSent) res.status(404).json(AppError.body('NOT_FOUND', 'Resource not found'));
    });
  }
}

interface UploadedImage {
  buffer: Buffer;
}

@Roles('TUTOR')
@Controller('tutor/profile')
export class TutorProfileController {
  constructor(private readonly profiles: TutorProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.profiles.get(user.id);
  }

  @Put()
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.profiles.update(user.id, parse(tutorProfileSchema, body));
  }

  @AllowMultipart()
  @RateLimit({ name: 'avatar-user', limit: 10, ttlMs: 60_000, key: (req) => (req.user ? `user:${req.user.id}` : null) })
  @Put('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0 } }))
  avatar(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedImage | undefined) {
    if (!file) throw AppError.validation([{ field: 'file', code: 'required' }]);
    return this.profiles.setAvatar(user.id, file.buffer);
  }

  @HttpCode(200)
  @Post('submit')
  submit(@CurrentUser() user: AuthUser) {
    return this.profiles.resubmit(user.id);
  }
}
