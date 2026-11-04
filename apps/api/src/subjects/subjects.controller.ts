import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

@Controller()
export class SubjectsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('subjects')
  list(): Promise<{ id: number; name: string; slug: string }[]> {
    return this.prisma.subject.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } });
  }
}
