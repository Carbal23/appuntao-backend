import { ApiProperty } from '@nestjs/swagger';
import { OwnershipTransferStatus } from '@prisma/client';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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

export class AcceptOwnershipTransferDto {
  @ApiProperty({
    type: [String],
    required: false,
    example: ['6b1f3c2e-8a4d-4c9b-9e2f-1a2b3c4d5e6f'],
    description:
      'Ids de los documentos vigentes para negocios que acepta quien recibe (GET /legal/current?audience=BUSINESS_OWNERS), como al crear un negocio. Puede omitirse si ya aceptó la versión vigente.',
  })
  @IsOptional()
  @IsArray({
    message: 'acceptedLegalDocumentIds debe ser una lista de ids de documentos',
  })
  @IsUUID('all', {
    each: true,
    message: 'Cada id de documento legal debe ser un UUID válido',
  })
  acceptedLegalDocumentIds?: string[];
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
