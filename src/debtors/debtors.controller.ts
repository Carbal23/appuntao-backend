import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { DebtorsService } from './debtors.service';
import { CreateDebtorDto } from './dto/create-debtor.dto';
import { UpdateDebtorDto } from './dto/update-debtor.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { BusinessRoleGuard } from 'src/auth/guards/business-role.guard';
import { BusinessRoles } from 'src/auth/decorators/business-role.decorator';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { BusinessContextGuard } from 'src/auth/guards/business-context.guard';
import { CurrentBusiness } from 'src/common/decorators/current-business.decorator';
import { DebtorQueryDto } from './dto/debtor-query.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BusinessProtected } from 'src/common/swagger/business.decorator';
import { DebtorResponseDto } from './dto/debtor-response.dto';
import { PaginatedDebtorResponseDto } from './dto/paginated-debtor-response.dto';
import { DebtorDetailResponseDto } from './dto/debtor-detail-response.dto';
import { DebtorSummaryResponseDto } from './dto/debtor-summary-response.dto';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { DebtorSummaryQueryDto } from './dto/debtor-summary-query.dto';

@ApiTags('Debtors')
@UseGuards(JwtAuthGuard, BusinessRoleGuard)
@ApiAuth()
@Controller('debtors')
export class DebtorsController {
  constructor(private readonly debtorsService: DebtorsService) {}

  @Post()
  @UseGuards(BusinessContextGuard)
  @BusinessProtected()
  @BusinessRoles('ADMIN', 'OWNER', 'CASHIER')
  @ApiOperation({ summary: 'Crear deudor' })
  @ApiResponse({
    status: 201,
    description: 'Deudor creado',
    type: DebtorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Ya existe un deudor con estos datos en este negocio o Error de validación',
  })
  create(
    @CurrentBusiness('businessId') businessId: string,
    @GetUser('id') currentUserId: string,
    @Body() data: CreateDebtorDto,
  ) {
    return this.debtorsService.create(businessId, currentUserId, data);
  }

  @Get()
  @UseGuards(BusinessContextGuard)
  @BusinessProtected()
  @ApiOperation({ summary: 'Listar deudores del negocio' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({
    name: 'hasDebt',
    required: false,
    description: 'true: solo con saldo. false: solo al día.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado de deudores',
    type: PaginatedDebtorResponseDto,
  })
  findAll(
    @CurrentBusiness('businessId') businessId: string,
    @Query() query: DebtorQueryDto,
  ) {
    return this.debtorsService.findAll(businessId, query);
  }

  @Get('me/all')
  @ApiOperation({ summary: 'Listar todos los deudores del usuario' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({
    name: 'hasDebt',
    required: false,
    description: 'true: solo con saldo. false: solo al día.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado global de deudores del usuario',
    type: PaginatedDebtorResponseDto,
  })
  findAllByUser(@GetUser('id') userId: string, @Query() query: DebtorQueryDto) {
    return this.debtorsService.findAllByUser(userId, query);
  }

  @Get('me/:debtorId/debts')
  @ApiOperation({
    summary: 'Deudas de una cuenta vinculada (modo cliente)',
    description:
      'Solo si la ficha de cliente está vinculada a la cuenta del usuario. No requiere x-business-id ni ser miembro del negocio. Devuelve todas las deudas con sus pagos, sin paginar.',
  })
  @ApiResponse({ status: 200, description: 'Deudas con sus pagos' })
  @ApiResponse({
    status: 404,
    description: 'La ficha no existe, no es del usuario o está inactiva',
  })
  findMyDebts(
    @GetUser('id') userId: string,
    @Param('debtorId') debtorId: string,
  ) {
    return this.debtorsService.findMyDebts(userId, debtorId);
  }

  @Delete('me/:debtorId/link')
  @ApiOperation({
    summary: 'Dejar de ver una tienda (modo cliente)',
    description:
      'Desvincula la ficha de la cuenta del usuario. La tienda conserva la ficha y sus deudas, y puede volver a invitarlo.',
  })
  @ApiResponse({ status: 200, description: 'Desvinculado' })
  @ApiResponse({
    status: 404,
    description: 'La ficha no está ligada a su cuenta',
  })
  unlinkMine(
    @GetUser('id') userId: string,
    @Param('debtorId') debtorId: string,
  ) {
    return this.debtorsService.unlinkByClient(userId, debtorId);
  }

  @Get('summary')
  @UseGuards(BusinessContextGuard)
  @BusinessProtected()
  @ApiOperation({ summary: 'Totales por cobrar del negocio' })
  @ApiQuery({ name: 'top', required: false, description: 'Tamaño del ranking' })
  @ApiResponse({
    status: 200,
    description: 'Saldo total, conteo de deudores y ranking por saldo',
    type: DebtorSummaryResponseDto,
  })
  getSummary(
    @CurrentBusiness('businessId') businessId: string,
    @Query() query: DebtorSummaryQueryDto,
  ) {
    return this.debtorsService.getSummary(businessId, query.top ?? 5);
  }

  @Get(':id')
  @UseGuards(BusinessContextGuard)
  @BusinessProtected()
  @ApiOperation({ summary: 'Obtener detalle de deudor' })
  @ApiResponse({
    status: 200,
    description: 'Detalle del deudor',
    type: DebtorDetailResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Deudor no encontrado o inactivo' })
  findOne(
    @Param('id') id: string,
    @CurrentBusiness('businessId') businessId: string,
  ) {
    return this.debtorsService.findOne(id, businessId);
  }

  @Patch(':id')
  @BusinessRoles('ADMIN', 'OWNER')
  @UseGuards(BusinessContextGuard)
  @BusinessProtected()
  @ApiOperation({ summary: 'Actualizar deudor' })
  @ApiResponse({
    status: 200,
    description: 'Deudor actualizado',
    type: DebtorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Deudor no encontrado',
  })
  update(
    @Param('id') id: string,
    @CurrentBusiness('businessId') businessId: string,
    @GetUser('id') currentUserId: string,
    @Body() data: UpdateDebtorDto,
  ) {
    return this.debtorsService.update(id, businessId, currentUserId, data);
  }

  @Patch(':id/unlink')
  @BusinessRoles('ADMIN', 'OWNER')
  @UseGuards(BusinessContextGuard)
  @BusinessProtected()
  @ApiOperation({
    summary: 'Desvincular el cliente de la cuenta que lo ve',
    description:
      'La cuenta deja de ver la tienda en el modo cliente. La ficha, sus deudas y sus pagos no cambian. Para volver a vincularla hay que invitar de nuevo.',
  })
  @ApiResponse({ status: 200, description: 'Cliente desvinculado' })
  @ApiResponse({ status: 404, description: 'Deudor no encontrado' })
  @ApiResponse({ status: 409, description: 'No estaba vinculado' })
  unlink(
    @Param('id') id: string,
    @CurrentBusiness('businessId') businessId: string,
    @GetUser('id') currentUserId: string,
  ) {
    return this.debtorsService.unlinkByBusiness(id, businessId, currentUserId);
  }

  @Patch(':id/inactivate')
  @BusinessRoles('ADMIN', 'OWNER')
  @UseGuards(BusinessContextGuard)
  @BusinessProtected()
  @ApiOperation({ summary: 'Inactiva deudor' })
  @ApiResponse({
    status: 200,
    description: 'Deudor inactivo',
    schema: {
      example: { message: 'Deudor inactivo' },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Deudor no encontrado',
  })
  inactivate(
    @Param('id') id: string,
    @CurrentBusiness('businessId') businessId: string,
    @GetUser('id') currentUserId: string,
  ) {
    return this.debtorsService.inactivate(id, businessId, currentUserId);
  }
}
