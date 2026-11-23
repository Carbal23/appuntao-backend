import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { PaymentMethod, PaymentType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyAmount, IsOptionalNote } from './payment-fields';

export class CreatePaymentDto {
  @ApiProperty({ example: '6f1c2a3b-0000-4000-8000-000000000000' })
  @IsUUID(undefined, { message: 'La deuda no es válida' })
  @IsNotEmpty()
  debtId!: string;

  @ApiProperty({
    example: 50000,
    description: 'Mayor que cero, máximo dos decimales y no más que el saldo',
  })
  @IsMoneyAmount()
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, example: 'CASH' })
  @IsEnum(PaymentMethod, {
    message: 'El método debe ser CASH, TRANSFER u OTHER',
  })
  method!: PaymentMethod;

  /**
   * Se acepta por compatibilidad con la app, que lo manda, pero solo como
   * `PAYMENT`. Los descuentos van por `POST /payments/discounts` y los
   * reversos los crea el backend.
   */
  @ApiPropertyOptional({ enum: [PaymentType.PAYMENT], example: 'PAYMENT' })
  @IsOptional()
  @IsIn([PaymentType.PAYMENT], {
    message:
      'Aquí solo se registran abonos (PAYMENT). Los descuentos van por /payments/discounts y los reversos por /payments/:id/reverse',
  })
  type?: PaymentType;

  @ApiPropertyOptional({ example: 'Abono del sábado', maxLength: 200 })
  @IsOptionalNote()
  note?: string;
}
