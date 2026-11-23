import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';
import { IsOptional, IsEnum, IsIn } from 'class-validator';
import { PaymentMethod, PaymentType } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const PAYMENT_SORT_FIELDS = [
  'createdAt',
  'paymentDate',
  'amount',
] as const;

export class QueryPaymentDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PAYMENT_SORT_FIELDS })
  @IsOptional()
  @IsIn(PAYMENT_SORT_FIELDS, {
    message: `sortBy debe ser uno de: ${PAYMENT_SORT_FIELDS.join(', ')}`,
  })
  sortBy?: string = undefined;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc' })
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ enum: PaymentType })
  @IsOptional()
  @IsEnum(PaymentType)
  type?: PaymentType;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}
