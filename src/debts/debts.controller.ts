import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Headers,
  Query,
} from '@nestjs/common';
import { DebtsService } from './debts.service';
import { CreateDebtDto } from './dto/create-debt.dto';
import { UpdateDebtStatusDto } from './dto/update-debt-status.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { BusinessRoles } from 'src/auth/decorators/business-role.decorator';
import { BusinessRoleGuard } from 'src/auth/guards/business-role.guard';
import { BusinessContextGuard } from 'src/auth/guards/business-context.guard';
import { CurrentBusiness } from 'src/common/decorators/current-business.decorator';
import { DEBT_SORT_FIELDS, QueryDebtDto } from './dto/query-debt.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { BusinessProtected } from 'src/common/swagger/business.decorator';
import { DebtResponseDto } from './dto/debt-response.dto';
import { DebtStatus } from '@prisma/client';
import { PaginatedDebtResponseDto } from './dto/paginated-debt-response.dto';

@ApiTags('Debts')
@UseGuards(JwtAuthGuard, BusinessContextGuard, BusinessRoleGuard)
@ApiAuth()
@BusinessProtected()
@Controller()
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @BusinessRoles('ADMIN', 'OWNER', 'CASHIER')
  @Post('debts')
  @ApiOperation({
    summary: 'Crear deuda (fiar)',
    description:
      'Saldo inicial = monto, estado OPEN y la moneda del negocio. No se puede fiar a un deudor inactivo.',
  })
  @ApiResponse({
    status: 201,
    description: 'Deuda creada',
    type: DebtResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Deudor no encontrado (o de otro negocio)',
  })
  @ApiResponse({
    status: 400,
    description:
      'Monto o fecha inválidos, vencimiento en el pasado o deudor inactivo',
  })
  create(
    @Body() dto: CreateDebtDto,
    @GetUser('id') userId: string,
    @CurrentBusiness('businessId') businessId: string,
  ) {
    return this.debtsService.create(dto, userId, businessId);
  }

  @Get('debts')
  @ApiOperation({
    summary: 'Listar deudas del negocio',
    description:
      'Incluye las de deudores inactivos (historial). search busca en la descripción y el nombre del deudor; overdue=true deja las que se deben y ya vencieron.',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: DEBT_SORT_FIELDS })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'status', required: false, enum: DebtStatus })
  @ApiQuery({ name: 'overdue', required: false, type: Boolean })
  @ApiResponse({
    status: 200,
    description: 'Listado de deudas',
    type: PaginatedDebtResponseDto,
  })
  findByBusiness(
    @CurrentBusiness('businessId') businessId: string,
    @Query() query: QueryDebtDto,
  ) {
    return this.debtsService.findByBusiness(businessId, query);
  }

  @Get('debtors/:debtorId/debts')
  @ApiOperation({
    summary: 'Listar deudas por deudor',
    description:
      'Paginado (10 por defecto). Para el saldo completo usar GET /debtors/:id, que trae todas.',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: DEBT_SORT_FIELDS })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'status', required: false, enum: DebtStatus })
  @ApiQuery({ name: 'overdue', required: false, type: Boolean })
  @ApiResponse({
    status: 200,
    description: 'Listado de deudas del deudor',
    type: PaginatedDebtResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Deudor no encontrado, de otro negocio o inactivo',
  })
  findByDebtor(
    @Param('debtorId') debtorId: string,
    @CurrentBusiness('businessId') businessId: string,
    @Query() query: QueryDebtDto,
  ) {
    return this.debtsService.findByDebtor(debtorId, businessId, query);
  }

  @BusinessRoles('ADMIN', 'OWNER')
  @Patch('debts/:id/status')
  @ApiOperation({
    summary: 'Anular una deuda',
    description:
      'Solo acepta status CANCELLED, y solo para una deuda OPEN sin abonos ni descuentos vigentes (los reversados no cuentan). Dueño o administrador. No se puede deshacer.',
  })
  @ApiResponse({
    status: 200,
    description: 'Deuda anulada',
    type: DebtResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Deuda no encontrada' })
  @ApiResponse({
    status: 400,
    description:
      'Estado distinto de CANCELLED, ya anulada o con abonos o descuentos vigentes',
  })
  @ApiResponse({ status: 403, description: 'El cajero no puede anular' })
  updateStatus(
    @Param('id') id: string,
    @GetUser('id') userId: string,
    @CurrentBusiness('businessId') businessId: string,
    @Body() dto: UpdateDebtStatusDto,
  ) {
    return this.debtsService.updateStatus(id, userId, businessId, dto);
  }
}
