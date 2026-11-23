import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { BusinessOwnershipService } from './business-ownership.service';
import {
  OwnershipTransferResponseDto,
  RequestOwnershipTransferDto,
} from './dto/ownership-transfer.dto';
import {
  PasswordConfirmLimit,
  PasswordConfirmThrottlerGuard,
} from 'src/common/guards/password-confirm-throttler.guard';

@ApiTags('Business')
@Controller('business')
@UseGuards(JwtAuthGuard)
@ApiAuth()
export class BusinessOwnershipController {
  constructor(private readonly ownership: BusinessOwnershipService) {}

  @Get('ownership-transfers/incoming')
  @ApiOperation({
    summary: 'Transferencias de negocios que el usuario tiene por responder',
  })
  @ApiResponse({ status: 200, type: [OwnershipTransferResponseDto] })
  listIncoming(@GetUser('id') userId: string) {
    return this.ownership.listIncoming(userId);
  }

  @Post('ownership-transfers/:transferId/accept')
  @ApiOperation({
    summary: 'Aceptar una transferencia: el usuario pasa a ser el dueño',
    description: 'El dueño anterior queda como ADMIN del negocio.',
  })
  @ApiResponse({ status: 201, description: 'Transferencia aceptada' })
  @ApiResponse({
    status: 400,
    description: 'Venció, el negocio ya no está activo o cambió de dueño',
  })
  @ApiResponse({ status: 409, description: 'Ya fue respondida' })
  accept(
    @Param('transferId') transferId: string,
    @GetUser('id') userId: string,
  ) {
    return this.ownership.acceptTransfer(transferId, userId);
  }

  @Post('ownership-transfers/:transferId/reject')
  @ApiOperation({ summary: 'Rechazar una transferencia' })
  @ApiResponse({ status: 201, description: 'Transferencia rechazada' })
  reject(
    @Param('transferId') transferId: string,
    @GetUser('id') userId: string,
  ) {
    return this.ownership.rejectTransfer(transferId, userId);
  }

  @Post(':id/ownership-transfer')
  @UseGuards(PasswordConfirmThrottlerGuard)
  @PasswordConfirmLimit()
  @ApiResponse({
    status: 429,
    description: 'Más de 5 intentos con contraseña en 15 minutos',
  })
  @ApiOperation({
    summary: 'Proponer la transferencia del negocio a un miembro',
    description:
      'Solo el dueño, confirmando con su contraseña. El miembro tiene 7 días para aceptarla.',
  })
  @ApiResponse({ status: 201, type: OwnershipTransferResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Contraseña incorrecta o el destinatario no es miembro activo',
  })
  @ApiResponse({ status: 403, description: 'No es el dueño' })
  @ApiResponse({ status: 409, description: 'Ya hay una pendiente' })
  request(
    @Param('id') businessId: string,
    @GetUser('id') userId: string,
    @Body() dto: RequestOwnershipTransferDto,
  ) {
    return this.ownership.requestTransfer(
      businessId,
      userId,
      dto.toUserId,
      dto.password,
    );
  }

  @Get(':id/ownership-transfers/history')
  @ApiOperation({
    summary: 'Últimas transferencias resueltas del negocio',
    description:
      'Hasta 3, de la más reciente a la más antigua: aceptadas, rechazadas, vencidas o canceladas en las que el usuario participó (como dueño que la propuso o como destinatario).',
  })
  @ApiResponse({ status: 200, type: [OwnershipTransferResponseDto] })
  listHistory(@Param('id') businessId: string, @GetUser('id') userId: string) {
    return this.ownership.listHistory(businessId, userId);
  }

  @Get(':id/ownership-transfer')
  @ApiOperation({
    summary:
      'Transferencia pendiente del negocio (para el dueño o el destinatario)',
    description: 'Devuelve null si no hay ninguna.',
  })
  @ApiResponse({ status: 200, type: OwnershipTransferResponseDto })
  getPending(@Param('id') businessId: string, @GetUser('id') userId: string) {
    return this.ownership.getPendingForBusiness(businessId, userId);
  }

  @Delete(':id/ownership-transfer')
  @ApiOperation({
    summary: 'Cancelar la transferencia pendiente (solo el dueño)',
  })
  @ApiResponse({ status: 200, description: 'Transferencia cancelada' })
  cancel(@Param('id') businessId: string, @GetUser('id') userId: string) {
    return this.ownership.cancelTransfer(businessId, userId);
  }
}
