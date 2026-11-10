import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBusinessUserDto } from './dto/create-business-user.dto';
import { UpdateBusinessUserDto } from './dto/update-business-user.dto';
import { BusinessUserRole, OwnershipTransferStatus } from '@prisma/client';
import { BusinessUserResponse } from './interfaces/business-user.interface';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { buildOrder } from 'src/common/pagination/utils/build-order.util';

@Injectable()
export class BusinessUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async addUserToBusiness(
    businessId: string,
    dto: CreateBusinessUserDto,
    addBy: string,
  ): Promise<BusinessUserResponse> {
    const { userId, role } = dto;

    const exists = await this.prisma.businessUser.findUnique({
      where: {
        businessId_userId: { businessId, userId },
      },
    });
    if (exists)
      throw new BadRequestException('El usuario ya pertenece al negocio');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no registrado en la app');

    const newBusinessUser = await this.prisma.businessUser.create({
      data: {
        businessId,
        userId,
        role: role || BusinessUserRole.VIEWER,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    await this.auditService.log({
      userId: addBy,
      action: AuditAction.BUSINESS_USER_ADDED,
      entity: 'BusinessUser',
      entityId: newBusinessUser.id,
      meta: {
        userId,
        businessId,
        role,
      },
    });

    return newBusinessUser;
  }

  async getUsersByBusiness(businessId: string, query: PaginationDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = query;

    const where: { businessId: string; user?: any } = {
      businessId,
      user: {},
    };

    if (search) {
      where.user = {
        OR: [
          {
            firstName: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            lastName: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ],
      };
    }

    return paginate(
      this.prisma.businessUser,
      {
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: buildOrder(sortBy, order),
      },
      { page, limit },
    );
  }

  async updateUserRole(
    businessId: string,
    businessUserId: string,
    dto: UpdateBusinessUserDto,
    currentUserId: string,
  ): Promise<BusinessUserResponse> {
    const membership = await this.prisma.businessUser.findUnique({
      where: { id: businessUserId },
    });
    if (!membership)
      throw new NotFoundException('Usuario no encontrado en el negocio');

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });

    if (membership.userId === business?.ownerId) {
      throw new ForbiddenException(
        'No puedes modificar el rol del propietario del negocio',
      );
    }

    if (membership.userId === currentUserId) {
      throw new ForbiddenException('No puedes modificar tu propio rol');
    }

    const updated = await this.prisma.businessUser.update({
      where: { id: businessUserId },
      data: { role: dto.role },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    await this.auditService.log({
      userId: currentUserId,
      action: AuditAction.BUSINESS_USER_ROLE_UPDATED,
      entity: 'BusinessUser',
      entityId: membership.id,
      meta: {
        userId: membership.userId,
        businessId,
        previusRole: membership.role,
        newRole: dto.role,
      },
    });

    return updated;
  }

  async removeUserFromBusiness(
    businessId: string,
    businessUserId: string,
    currentUserId: string,
  ): Promise<{ message: string }> {
    const membership = await this.prisma.businessUser.findUnique({
      where: { id: businessUserId },
    });
    if (!membership)
      throw new NotFoundException('Usuario no encontrado en el negocio');

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });

    if (membership.userId === business?.ownerId) {
      throw new ForbiddenException(
        'No puedes eliminar al propietario del negocio',
      );
    }

    if (membership.userId === currentUserId) {
      throw new ForbiddenException('No puedes eliminarte a ti mismo');
    }

    // Si tenía una transferencia del negocio por responder, se cancela: ya no
    // es miembro y no puede pasar a ser el dueño.
    await this.prisma.$transaction([
      this.prisma.businessUser.delete({
        where: { id: businessUserId },
      }),
      this.prisma.businessOwnershipTransfer.updateMany({
        where: {
          businessId: membership.businessId,
          toUserId: membership.userId,
          status: OwnershipTransferStatus.PENDING,
        },
        data: {
          status: OwnershipTransferStatus.CANCELLED,
          respondedAt: new Date(),
        },
      }),
    ]);

    await this.auditService.log({
      userId: currentUserId,
      action: AuditAction.BUSINESS_USER_REMOVED,
      entity: 'BusinessUser',
      entityId: membership.id,
      meta: {
        userId: membership.userId,
        businessId,
        role: membership.role,
      },
    });

    return { message: 'Usuario eliminado del negocio correctamente' };
  }
}
