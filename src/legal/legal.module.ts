import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LegalService } from './legal.service';
import { LegalController } from './legal.controller';

@Module({
  imports: [PrismaModule],
  providers: [LegalService],
  controllers: [LegalController],
  exports: [LegalService],
})
export class LegalModule {}
