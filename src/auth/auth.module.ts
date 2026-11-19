import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { UsersModule } from 'src/users/users.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { AuthLogModule } from 'src/auth-log/auth-log.module';
import { LegalModule } from 'src/legal/legal.module';
import { AccountLifecycleModule } from 'src/account-lifecycle/account-lifecycle.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') },
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 5 }],
      errorMessage:
        'Demasiados intentos de inicio de sesión. Intenta de nuevo en un minuto.',
    }),
    UsersModule,
    PrismaModule,
    AuthLogModule,
    LegalModule,
    AccountLifecycleModule,
  ],
  providers: [AuthService, JwtStrategy, LoginThrottlerGuard],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
