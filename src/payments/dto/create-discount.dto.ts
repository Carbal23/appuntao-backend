import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsMoneyAmount, IsReason } from './payment-fields';

export class CreateDiscountDto {
  @ApiProperty({ example: '6f1c2a3b-0000-4000-8000-000000000000' })
  @IsUUID(undefined, { message: 'La deuda no es válida' })
  @IsNotEmpty()
  debtId!: string;

  @ApiProperty({
    example: 300,
    description:
      'Lo que se le descuenta del saldo. Mayor que cero, máximo dos decimales y no más que el saldo',
  })
  @IsMoneyAmount()
  amount!: number;

  @ApiProperty({
    example: 'Se le perdonan las vueltas',
    minLength: 3,
    maxLength: 200,
  })
  @IsReason()
  reason!: string;
}
