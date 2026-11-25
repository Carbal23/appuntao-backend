import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { BUSINESS_ROLES_KEY } from '../decorators/business-role.decorator';
import { extractBusinessId } from 'src/common/utils/BusinessId.util';
import {
  loadBusinessMembership,
  type RequestWithMembership,
} from './business-membership';

/**
 * Restringe por rol dentro del negocio (`@BusinessRoles(...)`). Sin el
 * decorator deja pasar. Reutiliza la consulta de `BusinessContextGuard` si ya
 * corrió en la misma petición.
 */
@Injectable()
export class BusinessRoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      BUSINESS_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) return true;

    const request = context.switchToHttp().getRequest<
      Request &
        RequestWithMembership & {
          user?: { id: string; role: string };
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

    const { role } = await loadBusinessMembership(
      this.prisma,
      request,
      businessId,
      user.id,
    );

    if (!role) {
      throw new ForbiddenException('El usuario no pertenece a este negocio');
    }

    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException('Permisos insuficientes para este negocio');
    }

    return true;
  }
}
