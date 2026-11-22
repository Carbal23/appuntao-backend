/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { LogParams } from './audit.types';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sin `tx`, la auditoría es de mejor esfuerzo: va después de la operación y
   * un fallo solo se registra en consola. Con `tx` se escribe dentro de esa
   * transacción y un fallo la revierte: para operaciones de plata que no deben
   * quedar sin rastro.
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
      console.error('Audit log failed:', error);
    }
  }
}
