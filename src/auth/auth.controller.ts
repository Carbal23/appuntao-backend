import {
  Controller,
  Post,
  Body,
  Headers,
  BadRequestException,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LogoutDto } from './dto/logout.dto';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { ReqContext } from 'src/common/decorators/request-context.decorator';
import type { RequestContext } from 'src/auth-log/auth-log.types';
import { PasswordResetService } from './password-reset.service';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/password-reset.dto';
import {
  CodeAttemptLimit,
  CodeRequestLimit,
  EmailCodeThrottlerGuard,
} from './guards/email-code-throttler.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('login')
  @UseGuards(LoginThrottlerGuard)
  @ApiOperation({ summary: 'Autenticación de usuario' })
  @ApiResponse({
    status: 201,
    description: 'Login exitoso',
    type: TokenResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Credenciales inválidas',
  })
  @ApiResponse({
    status: 429,
    description: 'Demasiados intentos de inicio de sesión',
  })
  async login(
    @Body() dto: LoginDto,
    @ReqContext() context: RequestContext,
  ): Promise<TokenResponseDto> {
    return this.authService.login(dto, context);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Renovar access token usando refresh token',
    description:
      'Devuelve un access token y un refresh token nuevos. El refresh token enviado deja de servir: el cliente debe guardar el nuevo. Reutilizar un refresh token ya usado cierra la sesión.',
  })
  @ApiHeader({
    name: 'x-refresh-token',
    description: 'Refresh token',
    required: true,
  })
  @ApiHeader({
    name: 'x-device-id',
    description: 'Identificador del dispositivo',
    required: false,
  })
  @ApiResponse({
    status: 201,
    description: 'Token renovado',
    type: TokenResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token inválido o expirado',
  })
  async refresh(
    @Headers('x-refresh-token') refreshToken: string,
    @Headers('x-device-id') deviceId: string,
    @ReqContext() context: RequestContext,
  ) {
    if (!refreshToken)
      throw new BadRequestException('Refresh token no enviado');
    return this.authService.refreshTokens(refreshToken, deviceId, context);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Cerrar sesión',
    description:
      'allDevices: boolean - Si es true, cierra sesión en todos los dispositivos, de lo contrario solo en el dispositivo actual.',
  })
  @ApiHeader({
    name: 'x-refresh-token',
    description: 'Refresh token',
  })
  @ApiResponse({
    status: 201,
    description: 'Logout realizado',
  })
  @ApiResponse({
    status: 400,
    description: 'Refresh token no enviado',
  })
  @ApiBody({
    type: LogoutDto,
    required: false,
  })
  async logout(
    @Headers('x-refresh-token') refreshToken: string,
    @ReqContext() context: RequestContext,
    @Body()
    body?: LogoutDto,
  ) {
    return this.authService.logout(refreshToken, !!body?.allDevices, context);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EmailCodeThrottlerGuard)
  @CodeRequestLimit()
  @ApiOperation({
    summary: 'Pedir un código para cambiar la contraseña olvidada',
    description:
      'Si el correo es de una cuenta, le envía un código de 6 dígitos que vence en 15 minutos. Responde lo mismo exista o no la cuenta. Pedir un código nuevo anula el anterior. Como mucho uno por minuto y 5 al día por cuenta.',
  })
  @ApiResponse({ status: 200, description: 'Solicitud recibida' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.passwordReset.forgot(dto.email, context);
  }

  @Post('password/verify-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EmailCodeThrottlerGuard)
  @CodeAttemptLimit()
  @ApiOperation({
    summary: 'Comprobar el código antes de pedir la nueva contraseña',
    description:
      'No cambia nada; sirve para que la app pase a la pantalla de la nueva contraseña. Un fallo cuenta como intento: cada código admite 5.',
  })
  @ApiResponse({ status: 200, description: '{ valid: true }' })
  @ApiResponse({ status: 400, description: 'Código inválido o vencido' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos' })
  verifyResetCode(
    @Body() dto: VerifyResetCodeDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.passwordReset.verifyCode(dto, context);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EmailCodeThrottlerGuard)
  @CodeAttemptLimit()
  @ApiOperation({
    summary: 'Cambiar la contraseña olvidada con el código',
    description:
      'Cambia la contraseña, cierra todas las sesiones de la cuenta y envía un aviso al correo. No inicia sesión: la app debe llevar al login.',
  })
  @ApiResponse({ status: 200, description: 'Contraseña cambiada' })
  @ApiResponse({ status: 400, description: 'Código inválido o vencido' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos' })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.passwordReset.reset(dto, context);
  }
}
