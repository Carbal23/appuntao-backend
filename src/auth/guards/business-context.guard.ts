import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { extractBusinessId } from 'src/common/utils/BusinessId.util';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  loadBusinessMembership,
  type RequestWithMembership,
} from './business-membership';

/**
 * Exige el negocio activo: que exista, que no esté cerrado y que el usuario
 * sea miembro. Deja `request.business`. Ver docs/arquitectura.md.
 */
@Injectable()
export class BusinessContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request &
        RequestWithMembership & {
          user?: { id: string; role: string };
          business?: { id: string; inactivatedAt: Date | null };
          params?: { businessId?: string };
          query?: { businessId?: string };
        }
    >();

    const { user } = request;
    if (!user) throw new UnauthorizedException('Usuario no autenticado');

    const businessId = extractBusinessId(request);

    if (!businessId) {
      throw new ForbiddenException(
        'Debe especificar el negocio activo (x-business-id)',
      );
    }

    const membership = await loadBusinessMembership(
      this.prisma,
      request,
      businessId,
      user.id,
    );

    if (!membership.businessExists) {
      throw new NotFoundException('Negocio no encontrado');
    }

    if (membership.inactivatedAt) {
      throw new BadRequestException('El negocio se encuentra inactivado');
    }

    if (!membership.role) {
      throw new ForbiddenException('El usuario no pertenece a este negocio');
    }

    request.business = { id: businessId, inactivatedAt: null };

    return true;
  }
}
