import { IsIn } from 'class-validator';
import { BusinessUserRole } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { INVITABLE_ROLES } from 'src/invitations/invitation.constants';

export class UpdateBusinessUserDto {
  @ApiProperty({
    enum: INVITABLE_ROLES,
    example: BusinessUserRole.CASHIER,
    description:
      'OWNER no se asigna: el dueño solo cambia por transferencia. El administrador solo asigna CASHIER o VIEWER.',
  })
  @IsIn(INVITABLE_ROLES, {
    message: `role debe ser uno de: ${INVITABLE_ROLES.join(', ')}`,
  })
  role!: BusinessUserRole;
}
