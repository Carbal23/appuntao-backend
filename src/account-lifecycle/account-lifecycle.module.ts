import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthLogModule } from 'src/auth-log/auth-log.module';
import { AccountLifecycleService } from './account-lifecycle.service';
import { AccountMaintenanceService } from './account-maintenance.service';

@Module({
  imports: [PrismaModule, AuthLogModule],
  providers: [AccountLifecycleService, AccountMaintenanceService],
  exports: [AccountLifecycleService],
})
export class AccountLifecycleModule {}
