import { Module } from '@nestjs/common';
import { BusinessUserService } from './business-user.service';
import { BusinessUserController } from './business-user.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditModule } from 'src/audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [BusinessUserController],
  providers: [BusinessUserService],
  exports: [BusinessUserService],
})
export class BusinessUserModule {}
