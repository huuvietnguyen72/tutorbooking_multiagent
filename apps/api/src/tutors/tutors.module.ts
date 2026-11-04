import { Module } from '@nestjs/common';
import { PublicSlotsService } from '../slots/public-slots.service';
import { SubjectsController } from '../subjects/subjects.controller';
import { PublicTutorsService } from './public-tutors.service';
import { TutorProfileService } from './tutor-profile.service';
import { PublicTutorsController, TutorProfileController } from './tutors.controller';
import { TutorSlotsController } from '../slots/tutor-slots.controller';
import { TutorSlotsService } from '../slots/tutor-slots.service';

@Module({
  controllers: [SubjectsController, PublicTutorsController, TutorProfileController, TutorSlotsController],
  providers: [PublicTutorsService, PublicSlotsService, TutorProfileService, TutorSlotsService],
})
export class TutorsModule {}
