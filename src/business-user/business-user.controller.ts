import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BusinessUserService } from './business-user.service';
import { UpdateBusinessUserDto } from './dto/update-business-user.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentBusiness } from 'src/common/decorators/current-business.decorator';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { BusinessRoles } from 'src/auth/decorators/business-role.decorator';
import { BusinessRoleGuard } from 'src/auth/guards/business-role.guard';
import { BusinessContextGuard } from 'src/auth/guards/business-context.guard';
import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { BusinessUserResponseDto } from './dto/business-user-response.dto';
import { PaginatedBusinessUserResponseDto } from './dto/paginated-business-user-response.dto';
import { BusinessProtected } from 'src/common/swagger/business.decorator';

@ApiTags('Business Users')
@Controller('business-users')
@UseGuards(JwtAuthGuard, BusinessContextGuard, BusinessRoleGuard)
@ApiAuth()
@BusinessProtected()
export class BusinessUserController {
  constructor(private readonly businessUserService: BusinessUserService) {}

  // No hay alta directa de miembros: entran aceptando una invitación
  // (POST /invitations con type BUSINESS_USER).

  @Get()
  @BusinessRoles('ADMIN', 'OWNER', 'CASHIER', 'VIEWER')
  @ApiOperation({
    summary: 'Listar usuarios del negocio',
    description: 'Requiere cualquier rol dentro del negocio',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'search', required: false, example: 'juan' })
  @ApiQuery({ name: 'sortBy', required: false, example: 'createdAt' })
  @ApiQuery({ name: 'order', required: false, example: 'desc' })
  @ApiResponse({
    status: 200,
    description: 'Listado de usuarios del negocio',
    type: PaginatedBusinessUserResponseDto,
  })
  async findAll(
    @CurrentBusiness() businessId: string,
    @Query() query: PaginationDto,
  ) {
    return this.businessUserService.getUsersByBusiness(businessId, query);
  }

  @Patch(':id')
  @BusinessRoles('ADMIN', 'OWNER')
  @ApiOperation({
    summary: 'Actualizar rol de usuario en el negocio',
    description: 'Requiere rol ADMIN o OWNER dentro del negocio',
  })
  @ApiParam({ name: 'id', description: 'ID del businessUser' })
  @ApiResponse({
    status: 200,
    description: 'Rol actualizado correctamente',
    type: BusinessUserResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'No puedes modificar este usuario',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado en el negocio',
  })
  async updateRole(
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBusinessUserDto,
    @GetUser('id') currentUserId: string,
  ) {
    return this.businessUserService.updateUserRole(
      businessId,
      id,
      dto,
      currentUserId,
    );
  }

  @Delete(':id')
  @BusinessRoles('OWNER')
  @ApiOperation({
    summary: 'Eliminar usuario del negocio',
    description: 'Requiere rol OWNER dentro del negocio',
  })
  @ApiParam({ name: 'id', description: 'ID del businessUser' })
  @ApiResponse({
    status: 200,
    description: 'Usuario eliminado del negocio',
    schema: {
      example: {
        message: 'Usuario eliminado del negocio correctamente',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'No puedes eliminar este usuario',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado en el negocio',
  })
  async removeUser(
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @GetUser('id') currentUserId: string,
  ) {
    return this.businessUserService.removeUserFromBusiness(
      businessId,
      id,
      currentUserId,
    );
  }
}
