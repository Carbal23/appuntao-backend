import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { AuthLogEvent, Prisma, RefreshToken, User } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { IJwtPayload } from './interfaces/jwt-payload.interface';
import { UserSafe, userSafeSelect } from 'src/users/user.select';
import { serializeUser } from 'src/users/helpers/user.serializer';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { LegalService } from 'src/legal/legal.service';
import { AuthLogReason, RequestContext } from 'src/auth-log/auth-log.types';
import type { CredentialsCheck } from './interfaces/credentials-check.interface';
import type { Device } from './interfaces/device.interface';

/**
 * Margen para reutilizar un refresh token recién rotado sin tratarlo como
 * robo. Si el frontend lanza dos refresh a la vez con el mismo token, el
 * segundo llega unos milisegundos después del primero: se rechaza, pero sin
 * cerrar la sesión. Pasado este margen, la reutilización cierra la sesión.
 */
const REFRESH_REUSE_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly authLog: AuthLogService,
    private readonly legalService: LegalService,
  ) {}

  private async validateCredentials(
    identifier: string,
    password: string,
  ): Promise<CredentialsCheck> {
    const candidates = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: identifier },
          { phone: identifier },
          { documentNumber: identifier },
        ],
        inactivatedAt: null,
      },
      take: 2,
    });

    const matches: User[] = [];
    for (const candidate of candidates) {
      if (
        candidate.password &&
        (await bcrypt.compare(password, candidate.password))
      ) {
        matches.push(candidate);
      }
    }

    return {
      user: matches.length === 1 ? matches[0] : null,
      attemptedUserId: candidates.length === 1 ? candidates[0].id : null,
      ambiguous: matches.length > 1,
    };
  }

  private get accessTokenExpiresIn(): string {
    return this.config.getOrThrow<string>('jwt.expiresIn');
  }

  private signAccessToken(user: User) {
    const payload: IJwtPayload = { sub: user.id, role: user.role };
    return this.jwtService.signAsync(payload);
  }

  private hashToken(rawToken: string) {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private parseRefreshToken(presentedRefreshToken: string) {
    const separator = presentedRefreshToken.indexOf('.');
    const userId = presentedRefreshToken.slice(0, separator);
    const rawToken = presentedRefreshToken.slice(separator + 1);

    if (separator <= 0 || !rawToken) {
      throw new UnauthorizedException('Token inválido');
    }

    return { userId, rawToken };
  }

  private async findRefreshToken(
    presentedRefreshToken: string,
  ): Promise<RefreshToken | null> {
    const { userId, rawToken } = this.parseRefreshToken(presentedRefreshToken);

    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    return token && token.userId === userId ? token : null;
  }

  private isActive(token: RefreshToken) {
    return !token.rotatedAt && token.expiresAt > new Date();
  }

  private async issueRefreshToken(
    db: Prisma.TransactionClient,
    userId: string,
    familyId: string,
    device: Device,
  ) {
    const days = this.config.getOrThrow<number>('jwt.refreshTokenExpiresDays');
    const rawToken = randomBytes(64).toString('hex');

    const token = await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      },
    });

    return { token, refreshToken: `${userId}.${rawToken}` };
  }

  private async createRefreshToken(userId: string, device: Device) {
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        OR: [{ deviceId: device.deviceId }, { expiresAt: { lte: new Date() } }],
      },
    });

    return this.issueRefreshToken(this.prisma, userId, randomUUID(), device);
  }

  private async handleRefreshTokenReuse(
    token: RefreshToken,
    context?: RequestContext,
  ): Promise<never> {
    const rotatedAgo = Date.now() - (token.rotatedAt?.getTime() ?? 0);

    if (rotatedAgo <= REFRESH_REUSE_GRACE_MS) {
      throw new UnauthorizedException('Refresh token ya utilizado');
    }

    await this.prisma.refreshToken.deleteMany({
      where: { familyId: token.familyId },
    });
    await this.authLog.record({
      event: AuthLogEvent.REFRESH_TOKEN_REUSED,
      userId: token.userId,
      deviceId: token.deviceId,
      deviceName: token.deviceName,
      context,
    });

    throw new UnauthorizedException(
      'La sesión se cerró por seguridad. Inicia sesión de nuevo.',
    );
  }

  async login(
    dto: LoginDto,
    context?: RequestContext,
  ): Promise<TokenResponseDto> {
    const { user, attemptedUserId, ambiguous } = await this.validateCredentials(
      dto.identifier,
      dto.password,
    );

    if (!user) {
      await this.authLog.record({
        event: AuthLogEvent.LOGIN_FAILED,
        userId: attemptedUserId,
        identifier: dto.identifier,
        reason: ambiguous
          ? AuthLogReason.AMBIGUOUS_IDENTIFIER
          : AuthLogReason.INVALID_CREDENTIALS,
        deviceId: dto.deviceId,
        deviceName: dto.deviceName,
        context,
      });

      if (ambiguous) {
        throw new UnauthorizedException(
          'Este dato corresponde a más de una cuenta. Inicia sesión con otro dato (correo, teléfono o documento).',
        );
      }
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const accessToken = await this.signAccessToken(user);
    const { token, refreshToken } = await this.createRefreshToken(user.id, {
      deviceId: dto.deviceId,
      deviceName: dto.deviceName,
    });

    await this.authLog.record({
      event: AuthLogEvent.LOGIN_SUCCESS,
      userId: user.id,
      deviceId: dto.deviceId,
      deviceName: dto.deviceName,
      context,
    });

    return {
      user: serializeUser(user) as UserSafe,
      accessToken,
      accessTokenExpiresIn: this.accessTokenExpiresIn,
      refreshToken,
      refreshTokenExpiresAt: token.expiresAt.toISOString(),
      pendingLegalDocuments: await this.pendingLegalDocuments(user.id),
    };
  }

  async refreshTokens(
    presentedRefreshToken: string,
    deviceId?: string,
    context?: RequestContext,
  ): Promise<TokenResponseDto> {
    const token = await this.findRefreshToken(presentedRefreshToken);

    if (
      !token ||
      token.expiresAt <= new Date() ||
      (deviceId !== undefined && token.deviceId !== deviceId)
    ) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    if (token.rotatedAt) {
      return this.handleRefreshTokenReuse(token, context);
    }

    const user = await this.prisma.user.findFirst({
      where: { id: token.userId, inactivatedAt: null },
    });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');

    const next = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: token.id, rotatedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (count === 0) {
        throw new UnauthorizedException('Refresh token ya utilizado');
      }

      await tx.refreshToken.deleteMany({
        where: {
          familyId: token.familyId,
          rotatedAt: { not: null },
          id: { not: token.id },
        },
      });

      return this.issueRefreshToken(tx, token.userId, token.familyId, {
        deviceId: token.deviceId,
        deviceName: token.deviceName,
      });
    });

    return {
      user: serializeUser(user) as UserSafe,
      accessToken: await this.signAccessToken(user),
      accessTokenExpiresIn: this.accessTokenExpiresIn,
      refreshToken: next.refreshToken,
      refreshTokenExpiresAt: next.token.expiresAt.toISOString(),
      pendingLegalDocuments: await this.pendingLegalDocuments(user.id),
    };
  }

  async logout(
    presentedRefreshToken: string,
    allDevices = false,
    context?: RequestContext,
  ): Promise<{ message: string }> {
    if (!presentedRefreshToken) {
      throw new BadRequestException('Refresh token no enviado');
    }

    const found = await this.findRefreshToken(presentedRefreshToken);
    const token = found && this.isActive(found) ? found : null;

    if (allDevices) {
      if (!token) {
        throw new UnauthorizedException('Refresh token inválido o expirado');
      }
      await this.prisma.refreshToken.deleteMany({
        where: { userId: token.userId },
      });
      await this.authLog.record({
        event: AuthLogEvent.LOGOUT_ALL_DEVICES,
        userId: token.userId,
        deviceId: token.deviceId,
        deviceName: token.deviceName,
        context,
      });
      return { message: 'Sesiones cerradas en todos los dispositivos' };
    }

    if (!token) {
      return {
        message: 'Logout realizado (token no encontrado o ya eliminado)',
      };
    }

    await this.prisma.refreshToken.deleteMany({
      where: { familyId: token.familyId },
    });
    await this.authLog.record({
      event: AuthLogEvent.LOGOUT,
      userId: token.userId,
      deviceId: token.deviceId,
      deviceName: token.deviceName,
      context,
    });
    return { message: 'Logout realizado' };
  }

  private async pendingLegalDocuments(userId: string) {
    const pending = await this.legalService.getPendingDocuments(userId);
    return pending.map(({ id, type, version, title }) => ({
      id,
      type,
      version,
      title,
    }));
  }

  async getUserSafeById(id: string): Promise<UserSafe | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, inactivatedAt: null },
      select: userSafeSelect,
    });
    if (!user) return null;

    return user;
  }
}
