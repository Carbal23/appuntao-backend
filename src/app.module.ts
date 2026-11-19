import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import configs from './config';
import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import { BusinessUserModule } from './business-user/business-user.module';
import { DebtorsModule } from './debtors/debtors.module';
import { DebtsModule } from './debts/debts.module';
import { PaymentsModule } from './payments/payments.module';
import { InvitationsModule } from './invitations/invitations.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { LegalModule } from './legal/legal.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountLifecycleModule } from './account-lifecycle/account-lifecycle.module';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configs,
      envFilePath: `.env.${process.env.NODE_ENV || 'local'}`,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    BusinessModule,
    BusinessUserModule,
    DebtorsModule,
    DebtsModule,
    PaymentsModule,
    InvitationsModule,
    AuditModule,
    HealthModule,
    LegalModule,
    ScheduleModule.forRoot(),
    AccountLifecycleModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
