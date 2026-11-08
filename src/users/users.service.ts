import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthLogEvent, LegalAudience, Prisma, Role } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserSafe, userSafeSelect } from './user.select';
import { UserDashboardDto } from './dto/user-dashboard.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { LegalService } from 'src/legal/legal.service';
import {
  AuthLogReason,
  type RequestContext,
} from 'src/auth-log/auth-log.types';

const ADMIN_ONLY_FIELDS = [
  'email',
  'phone',
  'documentType',
  'documentNumber',
  'role',
] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authLog: AuthLogService,
    private readonly legalService: LegalService,
  ) {}

  async create(
    data: CreateUserDto,
    context?: RequestContext,
  ): Promise<UserSafe> {
    const { acceptedLegalDocumentIds, ...userData } = data;
    await this.legalService.assertAcceptsCurrent(
      acceptedLegalDocumentIds,
      LegalAudience.ALL_USERS,
    );

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email ?? undefined },
          { phone: data.phone ?? undefined },
          { documentNumber: data.documentNumber },
        ],
      },
    });

    if (existingUser) {
      if (existingUser.inactivatedAt) {
        throw new BadRequestException(
          `Ya existe un usuario registrado con ${
            existingUser.email === data.email
              ? 'este correo electrónico'
              : existingUser.phone === data.phone
                ? 'este número de teléfono'
                : 'este número de documento'
          }, pero actualmente está inactivo.`,
        );
      }

      if (existingUser.email === data.email) {
        throw new BadRequestException(
          'El correo electrónico ya está registrado.',
        );
      }
      if (existingUser.phone === data.phone) {
        throw new BadRequestException(
          'El número de teléfono ya está registrado.',
        );
      }
      if (existingUser.documentNumber === data.documentNumber) {
        throw new BadRequestException(
          'El número de documento ya está registrado.',
        );
      }
    }
    const hashedPassword: string = await bcrypt.hash(data.password, 10);

    try {
      // El usuario y la prueba de su aceptación se crean juntos: no puede
      // existir una cuenta sin el registro de que aceptó los documentos.
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            ...userData,
            role: Role.USER,
            password: hashedPassword,
          },
          select: userSafeSelect,
        });
        await this.legalService.recordConsents(
          tx,
          created.id,
          acceptedLegalDocumentIds,
          context,
        );
        return created;
      });

      const debtorMatches = await this.prisma.debtor.findMany({
        where: {
          OR: [
            { documentNumber: data.documentNumber ?? undefined },
            { phone: data.phone ?? undefined },
          ],
          userId: null,
        },
      });

      if (debtorMatches.length > 0) {
        await this.prisma.debtor.updateMany({
          where: {
            id: { in: debtorMatches.map((d) => d.id) },
          },
          data: { userId: user.id },
        });

        console.log(
          `🔗 Vinculados ${debtorMatches.length} deudores al usuario ${user.id}`,
        );
      }

      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const field = (error.meta?.target as string[])?.join(', ');
          throw new BadRequestException(
            `Ya existe un usuario con el campo único: ${field}.`,
          );
        }
      }
      throw error;
    }
  }

  async findAll(): Promise<UserSafe[]> {
    const users = this.prisma.user.findMany({
      where: { inactivatedAt: null },
      select: userSafeSelect,
    });

    return users;
  }

  async findOne(id: string): Promise<UserSafe | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSafeSelect,
    });
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async update(
    id: string,
    data: UpdateUserDto,
    actor: UserSafe,
  ): Promise<UserSafe> {
    this.assertCanManage(actor, id);

    const restricted = ADMIN_ONLY_FIELDS.filter(
      (field) => data[field] !== undefined,
    );
    if (restricted.length && actor.role !== Role.ADMIN) {
      throw new ForbiddenException(
        `Solo un administrador puede modificar: ${restricted.join(', ')}`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSafeSelect,
    });
    if (!user) throw new NotFoundException('User not found');

    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: userSafeSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const field = (error.meta?.target as string[])?.join(', ');
        throw new BadRequestException(
          `Ya existe un usuario con el campo único: ${field}.`,
        );
      }
      throw error;
    }
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    context?: RequestContext,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user?.password) throw new NotFoundException('User not found');

    const matches = await bcrypt.compare(dto.currentPassword, user.password);
    if (!matches) {
      await this.authLog.record({
        event: AuthLogEvent.PASSWORD_CHANGE_FAILED,
        userId,
        reason: AuthLogReason.WRONG_CURRENT_PASSWORD,
        context,
      });
      throw new BadRequestException('La contraseña actual no es correcta');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    await this.authLog.record({
      event: AuthLogEvent.PASSWORD_CHANGED,
      userId,
      context,
    });

    return { message: 'Contraseña actualizada correctamente' };
  }

  async inactivate(id: string, actor: UserSafe): Promise<{ message: string }> {
    this.assertCanManage(actor, id);

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: { inactivatedAt: new Date() },
    });

    return {
      message: 'User inactivated successfully',
    };
  }

  private assertCanManage(actor: UserSafe, targetId: string) {
    if (actor.id !== targetId && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('No puedes modificar a otro usuario');
    }
  }

  async getUserDashboard(userId: string): Promise<UserDashboardDto> {
    const userExists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!userExists) throw new Error('Usuario no encontrado');

    const [ownedBusinesses, workingBusinesses, clientBusinesses] =
      await Promise.all([
        this.prisma.business.findMany({
          where: { ownerId: userId },
          select: {
            id: true,
            name: true,
            address: true,
            currency: true,
            createdAt: true,
          },
        }),
        this.prisma.businessUser.findMany({
          where: { userId },
          select: {
            id: true,
            role: true,
            business: {
              select: {
                id: true,
                name: true,
                address: true,
                currency: true,
              },
            },
          },
        }),
        this.prisma.debtor.findMany({
          where: { userId },
          select: {
            id: true,
            name: true,
            phone: true,
            business: {
              select: {
                id: true,
                name: true,
                currency: true,
              },
            },
          },
        }),
      ]);

    return {
      ownedBusinesses,
      workingBusinesses,
      clientBusinesses,
    };
  }
}
