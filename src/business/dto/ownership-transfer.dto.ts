import { ApiProperty } from '@nestjs/swagger';
import { OwnershipTransferStatus } from '@prisma/client';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class RequestOwnershipTransferDto {
  @ApiProperty({
    description: 'Id del usuario (miembro del negocio) que recibe',
  })
  @IsUUID()
  toUserId!: string;

  @ApiProperty({ description: 'Contraseña del dueño, para confirmar' })
  @IsNotEmpty()
  @IsString()
  password!: string;
}

class TransferPersonDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

class TransferBusinessDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class OwnershipTransferResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  businessId!: string;

  @ApiProperty({ enum: OwnershipTransferStatus })
  status!: OwnershipTransferStatus;

  @ApiProperty({ description: 'Fecha límite para responder' })
  expiresAt!: Date;

  @ApiProperty({
    nullable: true,
    description:
      'Cuándo dejó de estar pendiente (aceptada, rechazada, vencida o cancelada)',
  })
  respondedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: TransferBusinessDto })
  business!: TransferBusinessDto;

  @ApiProperty({ type: TransferPersonDto })
  fromUser!: TransferPersonDto;

  @ApiProperty({ type: TransferPersonDto })
  toUser!: TransferPersonDto;
}
