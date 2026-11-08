import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthLogEvent, Prisma, Role } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserSafe, userSafeSelect } from './user.select';
import { UserDashboardDto } from './dto/user-dashboard.dto';
import { UserLookupResponseDto } from './dto/user-lookup.dto';
import { userIdentifierConditions } from 'src/common/validation/user-identifier';
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
    await this.legalService.assertAcceptsAllCurrent(acceptedLegalDocumentIds);

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(data.email ? [{ email: data.email }] : []),
          ...(data.phone ? [{ phone: data.phone }] : []),
          { documentNumber: data.documentNumber },
        ],
      },
    });

    if (existingUser) {
      if (existingUser.inactivatedAt) {
        throw new BadRequestException(
          `Ya existe una cuenta con ${
            existingUser.email === data.email
              ? 'este correo electrónico'
              : existingUser.phone === data.phone
                ? 'este número de teléfono'
                : 'este número de documento'
          }, pero está desactivada. Inicia sesión para reactivarla o comunícate con soporte.`,
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

  async findOne(id: string, actor: UserSafe): Promise<UserSafe | null> {
    if (actor.id !== id && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('No puedes ver los datos de otro usuario');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSafeSelect,
    });
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  /**
   * Busca un usuario activo por el dato exacto (correo, teléfono o
   * documento) y devuelve solo su nombre, para agregarlo a un negocio sin
   * exponer los datos de todos los usuarios.
   */
  async lookup(identifier: string): Promise<UserLookupResponseDto> {
    const users = await this.prisma.user.findMany({
      where: {
        inactivatedAt: null,
        anonymizedAt: null,
        OR: userIdentifierConditions(identifier),
      },
      select: { id: true, firstName: true, lastName: true },
      take: 2,
    });

    if (!users.length) {
      throw new NotFoundException(
        'No encontramos un usuario activo con ese correo, teléfono o documento',
      );
    }
    if (users.length > 1) {
      throw new ConflictException(
        'Ese dato corresponde a más de una cuenta. Búscalo con otro dato.',
      );
    }
    return users[0];
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

    // PartialType deja pasar `null` sin validarlo. Ningún campo editable se
    // puede vaciar: correo y teléfono son obligatorios desde el registro.
    const cleared = Object.entries(data)
      .filter(([, value]) => value === null)
      .map(([field]) => field);
    if (cleared.length) {
      throw new BadRequestException(
        `Estos campos no se pueden dejar vacíos: ${cleared.join(', ')}`,
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

    if (!userExists) throw new NotFoundException('Usuario no encontrado');

    const [ownedBusinesses, workingBusinesses, clientBusinesses] =
      await Promise.all([
        // Los propios incluyen los inactivos (marcados con inactivatedAt):
        // el dueño todavía puede descargar su información.
        this.prisma.business.findMany({
          where: { ownerId: userId },
          select: {
            id: true,
            name: true,
            address: true,
            currency: true,
            createdAt: true,
            inactivatedAt: true,
          },
        }),
        // Donde trabaja: solo negocios activos que no son suyos (el dueño
        // también figura como miembro OWNER y salía repetido).
        this.prisma.businessUser.findMany({
          where: {
            userId,
            business: { ownerId: { not: userId }, inactivatedAt: null },
          },
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
          where: {
            userId,
            inactivatedAt: null,
            business: { inactivatedAt: null },
          },
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
