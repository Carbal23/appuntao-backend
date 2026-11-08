import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateBusinessUserDto } from './dto/update-business-user.dto';
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

    await this.prisma.businessUser.delete({
      where: { id: businessUserId },
    });

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
