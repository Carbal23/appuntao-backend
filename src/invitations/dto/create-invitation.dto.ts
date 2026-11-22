import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { BusinessUserRole, InvitationType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsColombianPhone,
  IsNormalizedEmail,
} from 'src/common/validation/contact.validators';
import {
  DEFAULT_EXPIRATION_DAYS,
  INVITABLE_ROLES,
  MAX_EXPIRATION_DAYS,
} from '../invitation.constants';

export class CreateInvitationDto {
  @ApiProperty({
    enum: InvitationType,
    example: 'BUSINESS_USER',
    description:
      'BUSINESS_USER: invitar a un empleado. DEBTOR: invitar a un cliente a ver sus cuentas (vincula su cuenta con su registro de deudor).',
  })
  @IsEnum(InvitationType)
  type!: InvitationType;

  @ApiPropertyOptional({
    example: '3001234567',
    description:
      'Teléfono de la persona invitada. Para DEBTOR, si no se envía, se usa el del deudor.',
  })
  @IsOptional()
  @IsColombianPhone()
  phone?: string;

  @ApiPropertyOptional({ example: 'ana@correo.com' })
  @IsOptional()
  @IsNormalizedEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'uuid-del-deudor',
    description: 'Obligatorio si type = DEBTOR',
  })
  @IsOptional()
  @IsUUID()
  debtorId?: string;

  @ApiPropertyOptional({
    enum: INVITABLE_ROLES,
    example: 'CASHIER',
    description:
      'Obligatorio si type = BUSINESS_USER. No se puede invitar como OWNER.',
  })
  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: BusinessUserRole;

  @ApiPropertyOptional({
    example: DEFAULT_EXPIRATION_DAYS,
    description: `Días de vigencia (1 a ${MAX_EXPIRATION_DAYS}; por defecto ${DEFAULT_EXPIRATION_DAYS})`,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_EXPIRATION_DAYS)
  expiresInDays?: number;
}
