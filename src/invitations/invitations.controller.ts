import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { BusinessContextGuard } from 'src/auth/guards/business-context.guard';
import { BusinessRoleGuard } from 'src/auth/guards/business-role.guard';
import { BusinessRoles } from 'src/auth/decorators/business-role.decorator';
import { CurrentBusiness } from 'src/common/decorators/current-business.decorator';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { BusinessProtected } from 'src/common/swagger/business.decorator';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import type { UserSafe } from 'src/users/user.select';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ListInvitationsQueryDto } from './dto/list-invitations-query.dto';
import { InvitationThrottlerGuard } from './invitation-throttler.guard';

@ApiTags('Invitations')
@ApiAuth()
@UseGuards(JwtAuthGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  // ------------------------------------------------------ lado del negocio

  @Post()
  @UseGuards(BusinessContextGuard, BusinessRoleGuard, InvitationThrottlerGuard)
  @BusinessRoles('ADMIN', 'OWNER')
  @Throttle({ default: { limit: 30, ttl: 60 * 60 * 1000 } })
  @BusinessProtected()
  @ApiOperation({
    summary: 'Invitar a un empleado o a un cliente',
    description:
      'Va dirigida a un teléfono o correo. Si la persona ya tiene cuenta con ese dato, la ve en la app; si no, al registrarse con él. Devuelve shareText y whatsappUrl para compartirla. Máximo 30 por hora por negocio.',
  })
  @ApiResponse({ status: 201, description: 'Invitación creada' })
  @ApiResponse({ status: 400, description: 'Datos incompletos o inválidos' })
  @ApiResponse({
    status: 409,
    description:
      'Ya es miembro, el cliente ya está vinculado, o ya hay una invitación pendiente (INVITATION_ALREADY_PENDING)',
  })
  create(
    @Body() dto: CreateInvitationDto,
    @CurrentBusiness() businessId: string,
    @GetUser('id') userId: string,
  ) {
    return this.invitations.create(dto, businessId, userId);
  }

  @Get()
  @UseGuards(BusinessContextGuard, BusinessRoleGuard)
  @BusinessRoles('ADMIN', 'OWNER')
  @BusinessProtected()
  @ApiOperation({ summary: 'Invitaciones del negocio activo (x-business-id)' })
  list(
    @CurrentBusiness() businessId: string,
    @Query() query: ListInvitationsQueryDto,
  ) {
    return this.invitations.listForBusiness(businessId, query);
  }

  @Get('business/:businessId')
  @UseGuards(BusinessContextGuard, BusinessRoleGuard)
  @BusinessRoles('ADMIN', 'OWNER')
  @BusinessProtected()
  @ApiOperation({
    summary: 'Obsoleto: usar GET /invitations con x-business-id',
    deprecated: true,
  })
  listByBusiness(
    @Param('businessId') businessId: string,
    @CurrentBusiness() activeBusinessId: string,
    @Query() query: ListInvitationsQueryDto,
  ) {
    // Los permisos se validan con el negocio del header: si la ruta pide
    // otro negocio, se rechaza (antes permitía ver invitaciones ajenas).
    if (businessId !== activeBusinessId) {
      throw new ForbiddenException(
        'El negocio de la ruta no coincide con el negocio activo',
      );
    }
    return this.invitations.listForBusiness(businessId, query);
  }

  @Post(':id/resend')
  @UseGuards(BusinessContextGuard, BusinessRoleGuard, InvitationThrottlerGuard)
  @BusinessRoles('ADMIN', 'OWNER')
  @Throttle({ default: { limit: 30, ttl: 60 * 60 * 1000 } })
  @BusinessProtected()
  @ApiOperation({
    summary: 'Reenviar una invitación pendiente',
    description:
      'Renueva la vigencia y vuelve a enviar el correo. El código no cambia.',
  })
  resend(@Param('id') id: string, @CurrentBusiness() businessId: string) {
    return this.invitations.resend(id, businessId);
  }

  @Delete(':id')
  @UseGuards(BusinessContextGuard, BusinessRoleGuard)
  @BusinessRoles('ADMIN', 'OWNER')
  @BusinessProtected()
  @ApiOperation({ summary: 'Cancelar una invitación pendiente' })
  cancel(
    @Param('id') id: string,
    @CurrentBusiness() businessId: string,
    @GetUser('id') userId: string,
  ) {
    return this.invitations.cancel(id, businessId, userId);
  }

  // ------------------------------------------------ lado de la persona invitada

  @Get('incoming')
  @ApiOperation({
    summary: 'Invitaciones pendientes para el usuario autenticado',
    description:
      'Las dirigidas al correo o teléfono de su cuenta. Mostrarlas al abrir la app.',
  })
  listIncoming(@GetUser() user: UserSafe) {
    return this.invitations.listIncoming(user);
  }

  @Post('accept')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Aceptar una invitación con su código',
    description:
      'Solo la persona invitada: su correo o teléfono deben coincidir con los de la invitación. Máximo 10 intentos por minuto.',
  })
  @ApiResponse({ status: 201, description: 'Invitación aceptada' })
  @ApiResponse({
    status: 403,
    description: 'La invitación es para otra persona',
  })
  acceptByCode(@Body() dto: AcceptInvitationDto, @GetUser() user: UserSafe) {
    return this.invitations.acceptByCode(dto.code, user);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Aceptar una invitación que aparece en la app' })
  @ApiResponse({ status: 201, description: 'Invitación aceptada' })
  @ApiResponse({
    status: 403,
    description: 'La invitación es para otra persona',
  })
  acceptById(@Param('id') id: string, @GetUser() user: UserSafe) {
    return this.invitations.acceptById(id, user);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Rechazar una invitación' })
  reject(@Param('id') id: string, @GetUser() user: UserSafe) {
    return this.invitations.reject(id, user);
  }

  // Va al final: si no, Express tomaría "incoming" como un código.
  @Get(':code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @ApiOperation({
    summary: 'Ver una invitación por su código (solo la persona invitada)',
  })
  preview(@Param('code') code: string, @GetUser() user: UserSafe) {
    return this.invitations.previewByCode(code, user);
  }
}
