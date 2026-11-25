import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthLogModule } from 'src/auth-log/auth-log.module';
import { LegalModule } from 'src/legal/legal.module';
import { AccountLifecycleModule } from 'src/account-lifecycle/account-lifecycle.module';
import { EmailVerificationModule } from 'src/email-verification/email-verification.module';

@Module({
  imports: [
    PrismaModule,
    AuthLogModule,
    LegalModule,
    AccountLifecycleModule,
    EmailVerificationModule,
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
