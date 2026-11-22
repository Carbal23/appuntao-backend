import { IsIn } from 'class-validator';
import { DebtStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDebtStatusDto {
  @ApiProperty({
    enum: [DebtStatus.CANCELLED],
    example: DebtStatus.CANCELLED,
    description:
      'Solo se puede anular. `PARTIAL` y `PAID` salen de registrar pagos.',
  })
  @IsIn([DebtStatus.CANCELLED], {
    message:
      'Solo se puede anular la deuda (CANCELLED); los demás estados salen de registrar pagos',
  })
  status!: DebtStatus;
}
