import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { ReqContext } from 'src/common/decorators/request-context.decorator';
import type { RequestContext } from 'src/auth-log/auth-log.types';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserResponseDto } from './dto/user-response.dto';
import type { UserSafe } from './user.select';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { UserDashboardDto } from './dto/user-dashboard.dto';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { AccountLifecycleService } from 'src/account-lifecycle/account-lifecycle.service';
import {
  DeactivateAccountDto,
  DeletionPreviewDto,
  RequestAccountDeletionDto,
} from 'src/account-lifecycle/dto/account-lifecycle.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountLifecycle: AccountLifecycleService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Registrar un nuevo usuario' })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado correctamente',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o usuario ya existente',
  })
  create(@Body() data: CreateUserDto, @ReqContext() context: RequestContext) {
    return this.usersService.create(data, context);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Get()
  @ApiOperation({ summary: 'Obtener todos los usuarios activos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de usuarios',
    type: [UserResponseDto],
  })
  findAll() {
    return this.usersService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Obtener un usuario por ID' })
  @ApiResponse({
    status: 200,
    description: 'Usuario encontrado',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado',
  })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Patch('me/password')
  @ApiOperation({
    summary: 'Cambiar la contraseña del usuario autenticado',
    description:
      'Exige la contraseña actual. Cierra todas las sesiones: los refresh tokens existentes dejan de servir.',
  })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada' })
  @ApiResponse({
    status: 400,
    description: 'La contraseña actual no es correcta o la nueva no es válida',
  })
  changePassword(
    @GetUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.usersService.changePassword(userId, dto, context);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar un usuario',
    description:
      'El propio usuario solo puede cambiar firstName y lastName. Correo, teléfono, documento y rol solo los cambia un administrador.',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario actualizado',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado',
  })
  update(
    @Param('id') id: string,
    @Body() data: UpdateUserDto,
    @GetUser() actor: UserSafe,
  ) {
    return this.usersService.update(id, data, actor);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Post('me/deactivate')
  @ApiOperation({
    summary: 'Desactivar la propia cuenta (reversible)',
    description:
      'Cierra todas las sesiones. El usuario la reactiva iniciando sesión con reactivate: true.',
  })
  @ApiResponse({ status: 201, description: 'Cuenta desactivada' })
  @ApiResponse({ status: 400, description: 'La contraseña no es correcta' })
  deactivateMe(
    @GetUser('id') userId: string,
    @Body() dto: DeactivateAccountDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.accountLifecycle.deactivate(userId, dto.password, context);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Get('me/deletion-preview')
  @ApiOperation({
    summary: 'Qué pasará si el usuario elimina su cuenta',
    description:
      'Días de gracia y negocios activos de los que es dueño, con sus clientes y saldo por cobrar.',
  })
  @ApiResponse({ status: 200, type: DeletionPreviewDto })
  deletionPreview(@GetUser('id') userId: string) {
    return this.accountLifecycle.getDeletionPreview(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Post('me/deletion')
  @ApiOperation({
    summary: 'Solicitar la eliminación de la propia cuenta',
    description:
      'La cuenta queda inactiva y se anonimiza al terminar el plazo de gracia. Hasta entonces el usuario puede cancelarlo iniciando sesión con reactivate: true. Si es dueño de negocios activos debe enviar acknowledgeBusinessClosure: true.',
  })
  @ApiResponse({ status: 201, description: 'Eliminación programada' })
  @ApiResponse({
    status: 400,
    description:
      'Contraseña incorrecta, o falta confirmar el cierre de sus negocios (BUSINESS_CLOSURE_ACK_REQUIRED)',
  })
  requestDeletion(
    @GetUser('id') userId: string,
    @Body() dto: RequestAccountDeletionDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.accountLifecycle.requestDeletion(userId, dto, context);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiAuth()
  @Patch(':id/inactivate')
  @ApiOperation({ summary: 'Desactivar un usuario (solo ADMIN)' })
  @ApiResponse({ status: 200, description: 'Usuario desactivado' })
  @ApiResponse({ status: 403, description: 'No es administrador' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  inactivate(
    @Param('id') id: string,
    @GetUser('id') actorId: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.accountLifecycle.deactivateByAdmin(id, actorId, context);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiAuth()
  @Patch(':id/reactivate')
  @ApiOperation({ summary: 'Reactivar un usuario (solo ADMIN)' })
  @ApiResponse({ status: 200, description: 'Usuario reactivado' })
  @ApiResponse({ status: 403, description: 'No es administrador' })
  reactivate(@Param('id') id: string, @ReqContext() context: RequestContext) {
    return this.accountLifecycle.reactivateByAdmin(id, context);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Get('me/dashboard')
  @ApiOperation({ summary: 'Obtener dashboard del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Datos del dashboard',
    type: UserDashboardDto,
  })
  getUserDashboard(@GetUser('id') userId: string) {
    return this.usersService.getUserDashboard(userId);
  }
}
