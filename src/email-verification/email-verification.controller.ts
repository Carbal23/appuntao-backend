import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReqContext } from 'src/common/decorators/request-context.decorator';
import type { RequestContext } from 'src/auth-log/auth-log.types';
import {
  CodeAttemptLimit,
  CodeRequestLimit,
  EmailCodeThrottlerGuard,
} from 'src/auth/guards/email-code-throttler.guard';
import { EmailVerificationService } from './email-verification.service';
import {
  SendEmailVerificationDto,
  VerifyEmailDto,
} from './dto/email-verification.dto';

/**
 * Públicas: quien todavía no verificó el correo no puede iniciar sesión, así
 * que no tiene token.
 */
@ApiTags('Auth')
@Controller('auth/email')
@UseGuards(EmailCodeThrottlerGuard)
export class EmailVerificationController {
  constructor(private readonly emailVerification: EmailVerificationService) {}

  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  @CodeRequestLimit()
  @ApiOperation({
    summary: 'Pedir un código para verificar el correo',
    description:
      'Si el correo es de una cuenta sin verificar, le envía un código de 6 dígitos que vence en 15 minutos. Responde lo mismo exista o no la cuenta. El registro y el login de una cuenta sin verificar ya envían uno; esta ruta es para "Reenviar código". Como mucho uno por minuto y 5 al día por cuenta.',
  })
  @ApiResponse({ status: 200, description: 'Solicitud recibida' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  sendCode(
    @Body() dto: SendEmailVerificationDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.emailVerification.sendCode(dto.email, context);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @CodeAttemptLimit()
  @ApiOperation({
    summary: 'Verificar el correo con el código',
    description:
      'Marca el correo como verificado. No inicia sesión: la app repite el login. Cada código admite 5 intentos.',
  })
  @ApiResponse({ status: 200, description: 'Correo verificado' })
  @ApiResponse({ status: 400, description: 'Código inválido o vencido' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos' })
  verify(@Body() dto: VerifyEmailDto, @ReqContext() context: RequestContext) {
    return this.emailVerification.verify(dto, context);
  }
}
