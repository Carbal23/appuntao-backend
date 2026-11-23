import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { BusinessService } from './business.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { QueryBusinessDto } from './dto/query-business.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { BusinessResponseDto } from './dto/business-response.dto';
import { PaginatedBusinessResponseDto } from './dto/paginated-business-response.dto';
import { BusinessDetailResponseDto } from './dto/business-detail-response.dto';
import { BusinessExportService } from './business-export.service';
import { ReqContext } from 'src/common/decorators/request-context.decorator';
import type { RequestContext } from 'src/auth-log/auth-log.types';

@ApiTags('Business')
@Controller('business')
@UseGuards(JwtAuthGuard)
@ApiAuth()
export class BusinessController {
  constructor(
    private readonly businessService: BusinessService,
    private readonly businessExport: BusinessExportService,
  ) {}

  @Get(':id/export')
  @ApiOperation({
    summary: 'Descargar la información del negocio en Excel (solo el dueño)',
    description:
      'Archivo .xlsx con las hojas Resumen, Clientes, Deudas y Pagos. Funciona también con el negocio inactivo. Cada descarga queda registrada.',
  })
  @ApiResponse({ status: 200, description: 'Archivo .xlsx' })
  @ApiResponse({ status: 403, description: 'No es el dueño' })
  @ApiResponse({ status: 404, description: 'Negocio no encontrado' })
  async export(
    @Param('id') id: string,
    @GetUser('id') userId: string,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, content } = await this.businessExport.exportBusiness(
      id,
      userId,
      context,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(content);
  }

  @Post()
  @ApiOperation({
    summary: 'Crear un negocio',
    description:
      'Máximo 10 negocios activos como dueño; los cerrados no cuentan.',
  })
  @ApiResponse({
    status: 201,
    description: 'Negocio creado',
    type: BusinessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Error de validación, tope de 10 negocios activos, o no se aceptó la versión vigente de los documentos para negocios',
  })
  @ApiResponse({
    status: 503,
    description: 'No hay documentos para negocios publicados',
  })
  create(
    @Body() dto: CreateBusinessDto,
    @GetUser('id') userId: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.businessService.create(dto, userId, context);
  }

  @Get()
  @ApiOperation({ summary: 'Listar negocios del usuario' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'search', required: false, example: 'tienda' })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de negocios',
    type: PaginatedBusinessResponseDto,
  })
  findAll(@GetUser('id') userId: string, @Query() query: QueryBusinessDto) {
    return this.businessService.findAllByUser(userId, query);
  }

  // Va antes de `:id`, si no "closed" se tomaría como un id.
  @Get('closed')
  @ApiOperation({
    summary: 'Negocios cerrados del usuario (como dueño)',
    description:
      'Con la fecha en que se eliminan sus datos (`dataDeletionScheduledAt`) y si todavía se pueden reabrir (`canReactivate`). Hasta esa fecha el dueño puede descargarlos con GET /business/:id/export.',
  })
  @ApiResponse({ status: 200, description: 'Lista de negocios cerrados' })
  findClosed(@GetUser('id') userId: string) {
    return this.businessService.findClosedByOwner(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un negocio por ID' })
  @ApiResponse({
    status: 200,
    description: 'Detalle del negocio',
    type: BusinessDetailResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Negocio no encontrado' })
  @ApiResponse({ status: 400, description: 'Negocio inactivo' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a este negocio' })
  findOne(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.businessService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un negocio' })
  @ApiResponse({
    status: 200,
    description: 'Negocio actualizado correctamente',
    type: BusinessResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Negocio no encontrado' })
  @ApiResponse({
    status: 403,
    description: 'Solo el propietario puede actualizar',
  })
  @ApiResponse({
    status: 400,
    description: 'Negocio inactivado o datos inválidos',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessDto,
    @GetUser('id') userId: string,
  ) {
    return this.businessService.update(id, dto, userId);
  }

  @Patch(':id/inactivate')
  @ApiOperation({ summary: 'Inactivar un negocio' })
  @ApiResponse({
    status: 200,
    description: 'Negocio inactivado correctamente',
    schema: {
      example: {
        message: 'Negocio inactivado correctamente',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Negocio no encontrado' })
  @ApiResponse({
    status: 403,
    description: 'Solo el propietario puede inactivar',
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede inactivar por reglas de negocio',
  })
  inactivate(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.businessService.inactivate(id, userId);
  }

  @Patch(':id/reactivate')
  @ApiOperation({
    summary: 'Reabrir un negocio cerrado (solo el dueño)',
    description:
      'Vale mientras sus datos no se hayan eliminado. Vuelven sus clientes, deudas y equipo. Cuenta para el tope de 10 negocios activos.',
  })
  @ApiResponse({ status: 200, type: BusinessResponseDto })
  @ApiResponse({ status: 403, description: 'No es el dueño' })
  @ApiResponse({ status: 404, description: 'Negocio no encontrado' })
  @ApiResponse({
    status: 400,
    description: 'Ya está activo, venció el plazo o llegó al tope',
  })
  reactivate(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.businessService.reactivate(id, userId);
  }
}
