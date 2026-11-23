import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod, PaymentType } from '@prisma/client';

export class PaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 50000 })
  amount!: number;

  @ApiProperty({ enum: PaymentMethod })
  method!: PaymentMethod;

  @ApiProperty({ enum: PaymentType })
  type!: PaymentType;

  @ApiProperty({ example: 'Nota del pago', required: false })
  note?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  paymentDate!: Date;

  @ApiProperty({
    nullable: true,
    description: 'Pago global al que pertenece; se reversa con el grupo',
  })
  paymentGroupId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'En un REVERSAL, el movimiento que deshace',
  })
  reversedPaymentId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Si este movimiento ya fue reversado, su reverso',
  })
  reversal!: { id: string; createdAt: Date } | null;

  @ApiProperty()
  createdByUser!: {
    id: string;
    firstName: string;
    lastName: string;
  };
}
