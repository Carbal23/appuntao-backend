import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { BusinessRoleGuard } from 'src/auth/guards/business-role.guard';
import { BusinessRoles } from 'src/auth/decorators/business-role.decorator';
import { BusinessContextGuard } from 'src/auth/guards/business-context.guard';
import { CurrentBusiness } from 'src/common/decorators/current-business.decorator';
import { CreateGlobalPaymentDto } from './dto/create-global-payment.dto';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { PAYMENT_SORT_FIELDS, QueryPaymentDto } from './dto/query-payment.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { BusinessProtected } from 'src/common/swagger/business.decorator';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaginatedPaymentResponseDto } from './dto/paginated-payment-response.dto';
import { PaymentMethod, PaymentType } from '@prisma/client';
import { GlobalPaymentResponseDto } from './dto/global-payment-response.dto';

@ApiTags('Payments')
@UseGuards(JwtAuthGuard, BusinessContextGuard, BusinessRoleGuard)
@ApiAuth()
@BusinessProtected()
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @BusinessRoles('ADMIN', 'OWNER', 'CASHIER')
  @Post('payments')
  @ApiOperation({
    summary: 'Abonar a una deuda',
    description:
      'Solo abonos (PAYMENT). No más que el saldo; no sobre deudas pagadas o anuladas.',
  })
  @ApiResponse({
    status: 201,
    description: 'Abono registrado',
    type: PaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos, tipo distinto de PAYMENT, mayor al saldo, deuda pagada o anulada',
  })
  @ApiResponse({
    status: 404,
    description: 'Deuda no encontrada (o de otro negocio)',
  })
  create(
    @Body() dto: CreatePaymentDto,
    @GetUser('id') userId: string,
    @CurrentBusiness('businessId') businessId: string,
  ) {
    return this.paymentsService.create(dto, userId, businessId);
  }

  @BusinessRoles('ADMIN', 'OWNER')
  @Post('payments/discounts')
  @ApiOperation({
    summary: 'Descuento sobre una deuda',
    description:
      'Lo que el negocio le perdona al cliente: baja el saldo sin que entre plata. Dueño o administrador, con motivo, y no más que el saldo.',
  })
  @ApiResponse({
    status: 201,
    description: 'Descuento registrado',
    type: PaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Sin motivo, mayor al saldo, o deuda pagada o anulada',
  })
  @ApiResponse({ status: 403, description: 'El cajero no puede descontar' })
  @ApiResponse({ status: 404, description: 'Deuda no encontrada' })
  createDiscount(
    @Body() dto: CreateDiscountDto,
    @GetUser('id') userId: string,
    @CurrentBusiness('businessId') businessId: string,
  ) {
    return this.paymentsService.createDiscount(dto, userId, businessId);
  }

  @Post('payments/global')
  @BusinessRoles('ADMIN', 'OWNER', 'CASHIER')
  @ApiOperation({
    summary: 'Abonar al saldo total del cliente',
    description:
      'Se reparte entre sus deudas abiertas, de la más antigua a la más nueva (FIFO).',
  })
  @ApiResponse({
    status: 201,
    description: 'Pago global aplicado',
    type: GlobalPaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Monto inválido, mayor al saldo total o sin deudas pendientes',
  })
  @ApiResponse({ status: 404, description: 'Deudor no encontrado' })
  createGlobalPayment(
    @Body() dto: CreateGlobalPaymentDto,
    @GetUser('id') userId: string,
    @CurrentBusiness('businessId') businessId: string,
  ) {
    return this.paymentsService.createGlobalPayment(dto, userId, businessId);
  }

  @Post('payments/:id/reverse')
  @BusinessRoles('ADMIN', 'OWNER')
  @ApiOperation({
    summary: 'Reversar un abono o un descuento',
    description:
      'Crea un REVERSAL por el mismo valor, enlazado al original; cada movimiento se reversa una sola vez. Los abonos de un pago global se reversan con el grupo (400 PAYMENT_IN_GROUP con paymentGroupId).',
  })
  @ApiResponse({
    status: 201,
    description: 'Reverso registrado',
    type: PaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Ya reversado, es un reverso o es parte de un pago global',
  })
  @ApiResponse({ status: 403, description: 'El cajero no puede reversar' })
  @ApiResponse({ status: 404, description: 'Pago no encontrado' })
  reversePayment(
    @Param('id') id: string,
    @Body() dto: ReversePaymentDto,
    @GetUser('id') userId: string,
    @CurrentBusiness('businessId') businessId: string,
  ) {
    return this.paymentsService.reversePayment(id, dto, userId, businessId);
  }

  @Post('payments/global/reverse/:groupId')
  @BusinessRoles('ADMIN', 'OWNER')
  @ApiOperation({ summary: 'Reversar un pago global completo' })
  @ApiResponse({
    status: 201,
    description: 'Pago global reversado',
    schema: {
      example: {
        message: 'Pago global reversado correctamente',
        reversedCount: 3,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Pago global no encontrado' })
  @ApiResponse({ status: 400, description: 'Ya fue reversado' })
  reverse(
    @Param('groupId') groupId: string,
    @GetUser('id') userId: string,
    @CurrentBusiness('businessId') businessId: string,
  ) {
    return this.paymentsService.reversePaymentGroup(
      groupId,
      userId,
      businessId,
    );
  }

  @Get('payments')
  @ApiOperation({ summary: 'Listar movimientos del negocio' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'En la nota' })
  @ApiQuery({ name: 'sortBy', required: false, enum: PAYMENT_SORT_FIELDS })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'type', required: false, enum: PaymentType })
  @ApiQuery({ name: 'method', required: false, enum: PaymentMethod })
  @ApiResponse({
    status: 200,
    description: 'Listado de movimientos',
    type: PaginatedPaymentResponseDto,
  })
  findAll(
    @CurrentBusiness('businessId') businessId: string,
    @Query() query: QueryPaymentDto,
  ) {
    return this.paymentsService.findAll(businessId, query);
  }

  @Get('debts/:debtId/payments')
  @ApiOperation({ summary: 'Listar movimientos de una deuda' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'En la nota' })
  @ApiQuery({ name: 'sortBy', required: false, enum: PAYMENT_SORT_FIELDS })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'type', required: false, enum: PaymentType })
  @ApiQuery({ name: 'method', required: false, enum: PaymentMethod })
  @ApiResponse({
    status: 200,
    description: 'Movimientos de la deuda',
    type: PaginatedPaymentResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Deuda no encontrada' })
  findByDebt(
    @Param('debtId') debtId: string,
    @CurrentBusiness('businessId') businessId: string,
    @Query() query: QueryPaymentDto,
  ) {
    return this.paymentsService.findByDebt(debtId, businessId, query);
  }
}
