import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { BusinessUserRole, LegalAudience } from '@prisma/client';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';
import { buildWhere } from 'src/common/pagination/utils/build-where.util';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { buildOrder } from 'src/common/pagination/utils/build-order.util';
import { LegalService } from 'src/legal/legal.service';
import type { RequestContext } from 'src/auth-log/auth-log.types';

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly legalService: LegalService,
  ) {}

  async create(
    createBusinessDto: CreateBusinessDto,
    userId: string,
    context?: RequestContext,
  ) {
    const { acceptedLegalDocumentIds = [], ...businessData } =
      createBusinessDto;

    // Quien crea un negocio pasa a ser Responsable de los datos de sus
    // clientes: antes tiene que aceptar los documentos para negocios.
    await this.legalService.assertAcceptsCurrent(
      acceptedLegalDocumentIds,
      LegalAudience.BUSINESS_OWNERS,
      userId,
    );

    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          ...businessData,
          ownerId: userId,
        },
      });

      await this.legalService.recordConsents(
        tx,
        userId,
        acceptedLegalDocumentIds,
        context,
      );

      await tx.businessUser.create({
        data: {
          businessId: business.id,
          userId,
          role: BusinessUserRole.OWNER,
        },
      });

      await this.auditService.log({
        userId,
        action: AuditAction.BUSINESS_CREATED,
        entity: 'Business',
        entityId: business.id,
        meta: {
          businessName: business.name,
          address: business.address,
        },
      });

      return business;
    });
  }

  async findAllByUser(userId: string, query: PaginationDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = query;

    const where = buildWhere({
      search,
      searchFields: ['name'],
      filters: {
        OR: [{ ownerId: userId }, { businessUsers: { some: { userId } } }],
      },
    });

    return paginate(
      this.prisma.business,
      {
        where,
        include: {
          businessUsers: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: buildOrder(sortBy, order),
      },
      { page, limit },
    );
  }

  async findOne(id: string, userId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: {
        businessUsers: {
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
        },
      },
    });

    if (!business) throw new NotFoundException('Negocio no encontrado');

    if (business.inactivatedAt)
      throw new BadRequestException('Negocio inactivado');

    const isMember =
      business.ownerId === userId ||
      business.businessUsers.some((u) => u.userId === userId);
    if (!isMember)
      throw new ForbiddenException('No tienes acceso a este negocio');

    return business;
  }

  async update(id: string, dto: UpdateBusinessDto, userId: string) {
    const business = await this.prisma.business.findUnique({ where: { id } });
    if (!business) throw new NotFoundException('Negocio no encontrado');
    if (business.ownerId !== userId)
      throw new ForbiddenException(
        'Solo el propietario puede actualizar el negocio',
      );

    if (business.inactivatedAt)
      throw new BadRequestException(
        'No puedes modificar un negocio inactivado',
      );

    const updated = await this.prisma.business.update({
      where: { id },
      data: dto,
    });

    await this.auditService.log({
      userId,
      action: AuditAction.BUSINESS_UPDATED,
      entity: 'Business',
      entityId: updated.id,
      meta: {
        previousBusinessName: updated.name,
        newBusinessName: dto.name,
        previousAddress: updated.address,
        newAddress: dto.address,
      },
    });

    return updated;
  }

  async inactivate(id: string, userId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: {
        debts: true,
      },
    });

    if (!business) {
      throw new NotFoundException('Negocio no encontrado');
    }

    if (business.ownerId !== userId) {
      throw new ForbiddenException(
        'Solo el propietario puede inactivar el negocio',
      );
    }

    if (business.inactivatedAt) {
      throw new BadRequestException('El negocio ya está inactivo');
    }

    const hasActiveDebts = business.debts.some(
      (d) => d.status !== 'PAID' && d.status !== 'CANCELLED',
    );

    if (hasActiveDebts) {
      throw new BadRequestException(
        'No puedes inactivar un negocio con deudas activas',
      );
    }

    await this.prisma.business.update({
      where: { id },
      data: {
        inactivatedAt: new Date(),
      },
    });

    await this.auditService.log({
      userId,
      action: AuditAction.BUSINESS_DEACTIVATED,
      entity: 'Business',
      entityId: id,
    });

    return { message: 'Negocio inactivado correctamente' };
  }
}
