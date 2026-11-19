import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DeactivateAccountDto {
  @ApiProperty({ description: 'Contraseña actual, para confirmar' })
  @IsNotEmpty()
  @IsString()
  password!: string;
}

export class RequestAccountDeletionDto {
  @ApiProperty({ description: 'Contraseña actual, para confirmar' })
  @IsNotEmpty()
  @IsString()
  password!: string;

  @ApiPropertyOptional({
    description:
      'Obligatorio si el usuario es dueño de negocios activos: confirma que entiende que se cerrarán y sus datos se eliminarán más adelante.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeBusinessClosure?: boolean;
}

export class TransferCandidateDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ example: 'ADMIN' })
  role!: string;
}

export class PendingTransferSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  toUserId!: string;

  @ApiProperty()
  expiresAt!: Date;
}

export class OwnedBusinessSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Clientes activos' })
  debtorsCount!: number;

  @ApiProperty({
    description: 'Saldo por cobrar (deudas abiertas o parciales)',
  })
  pendingBalance!: number;

  @ApiProperty({
    type: [TransferCandidateDto],
    description: 'Miembros activos a los que se puede transferir el negocio',
  })
  transferCandidates!: TransferCandidateDto[];

  @ApiProperty({ type: PendingTransferSummaryDto, nullable: true })
  pendingTransfer!: PendingTransferSummaryDto | null;

  @ApiProperty({
    nullable: true,
    description: 'Última vez que el dueño descargó la información en Excel',
  })
  lastExportedAt!: Date | null;
}

export class DeletionPreviewDto {
  @ApiProperty({ example: 15 })
  gracePeriodDays!: number;

  @ApiProperty({ type: [OwnedBusinessSummaryDto] })
  ownedBusinesses!: OwnedBusinessSummaryDto[];
}
