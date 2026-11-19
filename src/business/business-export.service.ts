import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DebtStatus,
  DocumentType,
  PaymentMethod,
  PaymentType,
} from '@prisma/client';
import { Workbook, Worksheet } from 'exceljs';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import type { RequestContext } from 'src/auth-log/auth-log.types';

const DOCUMENT_TYPES: Record<DocumentType, string> = {
  CC: 'Cédula de ciudadanía',
  NIT: 'NIT',
  FOREIGNER: 'Documento de extranjería',
};
const DEBT_STATUSES: Record<DebtStatus, string> = {
  OPEN: 'Abierta',
  PARTIAL: 'Pago parcial',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
};
const PAYMENT_TYPES: Record<PaymentType, string> = {
  PAYMENT: 'Abono',
  ADJUSTMENT: 'Ajuste',
  REVERSAL: 'Reverso',
};
const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

const MONEY_FORMAT = '#,##0.00';
const DATE_FORMAT = 'dd/mm/yyyy hh:mm';
const DAY_FORMAT = 'dd/mm/yyyy';
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000; // Colombia: UTC-5, sin horario de verano

const person = (user: { firstName: string; lastName: string }) =>
  `${user.firstName} ${user.lastName}`;

/**
 * Excel guarda las fechas sin zona horaria: se escribe la hora de Colombia
 * para que el dueño vea en la hoja la misma hora que en la app.
 */
const toBogota = (date: Date | null) =>
  date ? new Date(date.getTime() - BOGOTA_OFFSET_MS) : null;

@Injectable()
export class BusinessExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Genera un Excel con los clientes, deudas y pagos del negocio. Solo el
   * dueño puede descargarlo, también si el negocio está inactivo (para que
   * conserve su información antes de que se elimine). Cada descarga queda
   * registrada como prueba de que se le entregaron sus datos.
   */
  async exportBusiness(
    businessId: string,
    userId: string,
    context?: RequestContext,
  ): Promise<{ filename: string; content: Buffer }> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException('Negocio no encontrado');
    if (business.ownerId !== userId) {
      throw new ForbiddenException(
        'Solo el dueño puede descargar la información del negocio',
      );
    }

    const userName = { select: { firstName: true, lastName: true } } as const;
    const [debtors, debts, payments] = await Promise.all([
      this.prisma.debtor.findMany({
        where: { businessId },
        orderBy: { name: 'asc' },
      }),
      this.prisma.debt.findMany({
        where: { businessId },
        include: {
          debtor: { select: { name: true } },
          createdByUser: userName,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { businessId },
        include: {
          debt: {
            select: { description: true, debtor: { select: { name: true } } },
          },
          createdByUser: userName,
        },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const pendingByDebtor = new Map<string, number>();
    for (const debt of debts) {
      if (debt.status === 'OPEN' || debt.status === 'PARTIAL') {
        pendingByDebtor.set(
          debt.debtorId,
          (pendingByDebtor.get(debt.debtorId) ?? 0) + debt.balance.toNumber(),
        );
      }
    }
    const totalPending = [...pendingByDebtor.values()].reduce(
      (sum, value) => sum + value,
      0,
    );

    const workbook = new Workbook();
    workbook.creator = 'Appuntao';
    workbook.created = new Date();

    const summary = workbook.addWorksheet('Resumen');
    summary.columns = [
      { header: 'Dato', key: 'label', width: 32 },
      { header: 'Valor', key: 'value', width: 40 },
    ];
    summary.addRows([
      { label: 'Negocio', value: business.name },
      { label: 'Dirección', value: business.address ?? '' },
      { label: 'Moneda', value: business.currency },
      { label: 'Fecha de descarga', value: toBogota(new Date()) },
      { label: 'Clientes', value: debtors.length },
      { label: 'Deudas', value: debts.length },
      { label: 'Pagos y movimientos', value: payments.length },
      { label: 'Saldo total por cobrar', value: totalPending },
    ]);
    summary.getCell('B5').numFmt = DATE_FORMAT;
    summary.getCell('B9').numFmt = MONEY_FORMAT;
    styleHeader(summary);

    const clients = workbook.addWorksheet('Clientes');
    clients.columns = [
      { header: 'Nombre', key: 'name', width: 30 },
      { header: 'Teléfono', key: 'phone', width: 16 },
      { header: 'Tipo de documento', key: 'documentType', width: 24 },
      { header: 'Número de documento', key: 'documentNumber', width: 20 },
      { header: 'Notas', key: 'notes', width: 30 },
      {
        header: 'Saldo por cobrar',
        key: 'pending',
        width: 18,
        style: { numFmt: MONEY_FORMAT },
      },
      { header: 'Estado', key: 'status', width: 12 },
      {
        header: 'Registrado',
        key: 'createdAt',
        width: 18,
        style: { numFmt: DATE_FORMAT },
      },
    ];
    clients.addRows(
      debtors.map((debtor) => ({
        name: debtor.name,
        phone: debtor.phone ?? '',
        documentType: debtor.documentType
          ? DOCUMENT_TYPES[debtor.documentType]
          : '',
        documentNumber: debtor.documentNumber ?? '',
        notes: debtor.notes ?? '',
        pending: pendingByDebtor.get(debtor.id) ?? 0,
        status: debtor.inactivatedAt ? 'Inactivo' : 'Activo',
        createdAt: toBogota(debtor.createdAt),
      })),
    );
    styleHeader(clients);

    const debtsSheet = workbook.addWorksheet('Deudas');
    debtsSheet.columns = [
      { header: 'Cliente', key: 'debtor', width: 30 },
      { header: 'Descripción', key: 'description', width: 32 },
      {
        header: 'Monto',
        key: 'amount',
        width: 16,
        style: { numFmt: MONEY_FORMAT },
      },
      {
        header: 'Saldo',
        key: 'balance',
        width: 16,
        style: { numFmt: MONEY_FORMAT },
      },
      { header: 'Estado', key: 'status', width: 14 },
      {
        header: 'Vence',
        key: 'dueDate',
        width: 14,
        style: { numFmt: DAY_FORMAT },
      },
      {
        header: 'Creada',
        key: 'createdAt',
        width: 18,
        style: { numFmt: DATE_FORMAT },
      },
      { header: 'Creada por', key: 'createdBy', width: 24 },
    ];
    debtsSheet.addRows(
      debts.map((debt) => ({
        debtor: debt.debtor.name,
        description: debt.description ?? '',
        amount: debt.amount.toNumber(),
        balance: debt.balance.toNumber(),
        status: DEBT_STATUSES[debt.status],
        dueDate: toBogota(debt.dueDate),
        createdAt: toBogota(debt.createdAt),
        createdBy: person(debt.createdByUser),
      })),
    );
    styleHeader(debtsSheet);

    const paymentsSheet = workbook.addWorksheet('Pagos');
    paymentsSheet.columns = [
      { header: 'Cliente', key: 'debtor', width: 30 },
      { header: 'Deuda', key: 'debt', width: 30 },
      { header: 'Tipo', key: 'type', width: 12 },
      {
        header: 'Monto',
        key: 'amount',
        width: 16,
        style: { numFmt: MONEY_FORMAT },
      },
      { header: 'Método', key: 'method', width: 16 },
      { header: 'Nota', key: 'note', width: 30 },
      {
        header: 'Fecha',
        key: 'paymentDate',
        width: 18,
        style: { numFmt: DATE_FORMAT },
      },
      { header: 'Registrado por', key: 'createdBy', width: 24 },
    ];
    paymentsSheet.addRows(
      payments.map((payment) => ({
        debtor: payment.debt.debtor.name,
        debt: payment.debt.description ?? '',
        type: PAYMENT_TYPES[payment.type],
        amount: payment.amount.toNumber(),
        method: PAYMENT_METHODS[payment.method],
        note: payment.note ?? '',
        paymentDate: toBogota(payment.paymentDate),
        createdBy: person(payment.createdByUser),
      })),
    );
    styleHeader(paymentsSheet);

    const content = Buffer.from(await workbook.xlsx.writeBuffer());

    await this.auditService.log({
      userId,
      action: AuditAction.BUSINESS_DATA_EXPORTED,
      entity: 'Business',
      entityId: businessId,
      meta: {
        debtors: debtors.length,
        debts: debts.length,
        payments: payments.length,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      },
    });

    const today = toBogota(new Date())!.toISOString().slice(0, 10);
    return {
      filename: `appuntao-${slugify(business.name)}-${today}.xlsx`,
      content,
    };
  }
}

function styleHeader(sheet: Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF4' },
  };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function slugify(text: string) {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'negocio'
  );
}
