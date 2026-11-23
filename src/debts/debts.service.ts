import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDebtDto } from './dto/create-debt.dto';
import { UpdateDebtStatusDto } from './dto/update-debt-status.dto';
import { debtSelect } from './debt.select';
import { DebtStatus, PaymentType, Prisma } from '@prisma/client';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import { paginate } from 'src/common/pagination/utils/paginate.util';
import { QueryDebtDto } from './dto/query-debt.dto';

const OPEN_STATUSES: DebtStatus[] = [DebtStatus.OPEN, DebtStatus.PARTIAL];

// Margen para el vencimiento: el cliente manda el fin del día en su hora
// local, y un reloj adelantado o una zona horaria distinta no deben hacer que
// "vence hoy" se rechace como fecha pasada.
const DUE_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(createDto: CreateDebtDto, userId: string, businessId: string) {
    const { debtorId, amount, description, dueDate } = createDto;

    // Un deudor de otro negocio responde igual que uno que no existe: no se
    // confirma que el id exista en otro lado. Al inactivo no se le fía más:
    // ya salió de la lista del negocio y su cuenta quedó desvinculada.
    const debtor = await this.prisma.debtor.findFirst({
      where: { id: debtorId, businessId },
      select: {
        id: true,
        inactivatedAt: true,
        business: { select: { currency: true } },
      },
    });
    if (!debtor) throw new NotFoundException('Deudor no encontrado');
    if (debtor.inactivatedAt) {
      throw new BadRequestException(
        'El cliente fue quitado de la lista del negocio; regístralo de nuevo para fiarle',
      );
    }

    if (dueDate && dueDate.getTime() < Date.now() - DUE_DATE_TOLERANCE_MS) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'La fecha de vencimiento no puede estar en el pasado',
        errors: {
          dueDate: 'La fecha de vencimiento no puede estar en el pasado',
        },
      });
    }

    const debt = await this.prisma.debt.create({
      data: {
        businessId,
        debtorId,
        amount: new Prisma.Decimal(amount),
        balance: new Prisma.Decimal(amount),
        currency: debtor.business.currency,
        description: description || null,
        dueDate: dueDate ?? null,
        createdBy: userId,
      },
      select: debtSelect,
    });

    await this.auditService.log({
      userId,
      action: AuditAction.DEBT_CREATED,
      entity: 'Debt',
      entityId: debt.id,
      meta: {
        amount,
        debtorId,
        businessId,
        dueDate: dueDate?.toISOString() ?? null,
      },
    });

    return debt;
  }

  findByBusiness(businessId: string, query: QueryDebtDto) {
    return this.list({ businessId }, query);
  }

  async findByDebtor(
    debtorId: string,
    businessId: string,
    query: QueryDebtDto,
  ) {
    // Igual que el detalle del deudor: uno ajeno o inactivo responde 404.
    const debtor = await this.prisma.debtor.findFirst({
      where: { id: debtorId, businessId },
      select: { inactivatedAt: true },
    });
    if (!debtor) throw new NotFoundException('Deudor no encontrado');
    if (debtor.inactivatedAt) {
      throw new NotFoundException('Deudor se encuentra inactivo');
    }

    return this.list({ businessId, debtorId }, query);
  }

  private list(scope: Prisma.DebtWhereInput, query: QueryDebtDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy,
      order = 'desc',
      status,
      overdue,
    } = query;

    const and: Prisma.DebtWhereInput[] = [scope];
    if (status) and.push({ status });
    // "Vencida" es una deuda que todavía se debe y cuya fecha ya pasó. Se suma
    // con AND: combinada con `status` debe respetar los dos filtros.
    if (overdue) {
      and.push({
        status: { in: OPEN_STATUSES },
        balance: { gt: 0 },
        dueDate: { lt: new Date() },
      });
    }
    const term = search?.trim();
    if (term) {
      and.push({
        OR: [
          { description: { contains: term, mode: 'insensitive' } },
          { debtor: { name: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }

    // `id` desempata: con fechas iguales el orden de Postgres no es estable y
    // una deuda podía repetirse o saltarse entre páginas.
    const orderBy: Prisma.DebtOrderByWithRelationInput[] = [
      { [sortBy ?? 'createdAt']: order },
      { id: order },
    ];

    return paginate(
      this.prisma.debt,
      { where: { AND: and }, orderBy, select: debtSelect },
      { page, limit },
    );
  }

  /**
   * Único cambio manual de estado: anular (`CANCELLED`). `PARTIAL` y `PAID`
   * los calcula `payments` a partir del saldo; ponerlos a mano dejaba deudas
   * "pagadas" con saldo y sin ningún pago que lo explique.
   */
  async updateStatus(
    id: string,
    userId: string,
    businessId: string,
    updateDto: UpdateDebtStatusDto,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // El mismo bloqueo que toma `payments` al registrar un pago: así un pago
      // y una anulación simultáneos no pueden colarse uno detrás del otro.
      await tx.$queryRaw`SELECT id FROM "Debt" WHERE id = ${id} FOR UPDATE`;

      const debt = await tx.debt.findFirst({
        where: { id, businessId },
        select: {
          status: true,
          // Abonos y descuentos que siguen vigentes (sin reverso). Uno ya
          // reversado no cuenta: su efecto en el saldo quedó en cero.
          _count: {
            select: {
              payments: {
                where: {
                  type: { in: [PaymentType.PAYMENT, PaymentType.DISCOUNT] },
                  reversal: { is: null },
                },
              },
            },
          },
        },
      });
      if (!debt) throw new NotFoundException('Deuda no encontrada');

      if (debt.status === DebtStatus.CANCELLED) {
        throw new BadRequestException('La deuda ya está anulada');
      }
      if (debt.status !== DebtStatus.OPEN || debt._count.payments > 0) {
        throw new BadRequestException(
          'No puedes anular una deuda con abonos o descuentos vigentes: reversa primero',
        );
      }

      const result = await tx.debt.update({
        where: { id },
        data: { status: updateDto.status },
        select: debtSelect,
      });

      // Dentro de la transacción: anular borra plata del saldo, y si no queda
      // el rastro de quién lo hizo, no se anula.
      await this.auditService.log(
        {
          userId,
          action: AuditAction.DEBT_CANCELLED,
          entity: 'Debt',
          entityId: id,
          meta: {
            previousStatus: debt.status,
            newStatus: updateDto.status,
            amount: result.amount.toNumber(),
            balance: result.balance.toNumber(),
            debtorId: result.debtor.id,
            businessId,
          },
        },
        tx,
      );

      return result;
    });

    return updated;
  }
}
