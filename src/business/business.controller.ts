import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { BusinessService } from './business.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { BusinessResponseDto } from './dto/business-response.dto';
import { PaginatedBusinessResponseDto } from './dto/paginated-business-response.dto';
import { BusinessDetailResponseDto } from './dto/business-detail-response.dto';
import { ReqContext } from 'src/common/decorators/request-context.decorator';
import type { RequestContext } from 'src/auth-log/auth-log.types';

@ApiTags('Business')
@Controller('business')
@UseGuards(JwtAuthGuard)
@ApiAuth()
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un negocio' })
  @ApiResponse({
    status: 201,
    description: 'Negocio creado',
    type: BusinessResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Error de validación, o no se aceptó la versión vigente de los documentos para negocios',
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
  @ApiQuery({ name: 'sortBy', required: false, example: 'createdAt' })
  @ApiQuery({ name: 'order', required: false, example: 'desc' })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de negocios',
    type: PaginatedBusinessResponseDto,
  })
  findAll(@GetUser('id') userId: string, @Query() query: PaginationDto) {
    return this.businessService.findAllByUser(userId, query);
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
}
