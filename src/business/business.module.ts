import { Module } from '@nestjs/common';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditModule } from 'src/audit/audit.module';
import { BusinessOwnershipService } from './business-ownership.service';
import { BusinessOwnershipController } from './business-ownership.controller';
import { BusinessExportService } from './business-export.service';
import { LegalModule } from 'src/legal/legal.module';
import { EmailProvider } from 'src/providers/email.provider';

@Module({
  imports: [PrismaModule, AuditModule, LegalModule],
  controllers: [BusinessController, BusinessOwnershipController],
  providers: [
    BusinessService,
    BusinessOwnershipService,
    BusinessExportService,
    EmailProvider,
  ],
  exports: [BusinessService],
})
export class BusinessModule {}
