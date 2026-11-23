import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptionalNote } from './payment-fields';

export class ReversePaymentDto {
  @ApiPropertyOptional({
    example: 'Se registró 50.000 y eran 5.000',
    maxLength: 200,
  })
  @IsOptionalNote()
  reason?: string;
}
