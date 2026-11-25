import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthLogModule } from 'src/auth-log/auth-log.module';
import { EmailProvider } from 'src/providers/email.provider';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationController } from './email-verification.controller';

/**
 * Verificar el correo. Módulo aparte porque lo usan `users` (enviar el código
 * al registrarse) y `auth` (exigirlo al iniciar sesión), y `auth` ya importa
 * `users`.
 */
@Module({
  imports: [PrismaModule, AuthLogModule],
  providers: [EmailVerificationService, EmailProvider],
  controllers: [EmailVerificationController],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule {}
