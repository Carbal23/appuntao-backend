import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { LogParams } from './audit.types';

/**
 * Auditoría de acciones: quién hizo qué, sobre qué entidad y con qué datos.
 * Ver docs/modulos/audit.md.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Con `tx` se escribe dentro de esa transacción y un fallo la revierte: es
   * lo que usan las operaciones de plata, de acceso y de permisos, que no
   * deben quedar sin rastro. Sin `tx` es de mejor esfuerzo: va después de la
   * operación y un fallo solo queda en el log del servidor.
   */
  async log(params: LogParams, tx?: Prisma.TransactionClient) {
    const { userId, action, entity, entityId, meta } = params;
    const data = { userId, action, entity, entityId, meta };

    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }

    try {
      await this.prisma.auditLog.create({ data });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la auditoría ${action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
