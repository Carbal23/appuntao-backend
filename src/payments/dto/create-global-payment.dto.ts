import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyAmount, IsOptionalNote } from './payment-fields';

export class CreateGlobalPaymentDto {
  @ApiProperty({ example: '6f1c2a3b-0000-4000-8000-000000000000' })
  @IsUUID(undefined, { message: 'El deudor no es válido' })
  @IsNotEmpty()
  debtorId!: string;

  @ApiProperty({
    example: 50000,
    description:
      'Mayor que cero, máximo dos decimales y no más que el saldo total',
  })
  @IsMoneyAmount()
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, example: 'TRANSFER' })
  @IsEnum(PaymentMethod, {
    message: 'El método debe ser CASH, TRANSFER u OTHER',
  })
  method!: PaymentMethod;

  @ApiPropertyOptional({ example: 'Pago de la quincena', maxLength: 200 })
  @IsOptionalNote()
  note?: string;
}
