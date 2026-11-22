import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';
import { IsOptional, IsEnum, IsBoolean, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { DebtStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const DEBT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'amount',
  'balance',
  'dueDate',
  'status',
] as const;

export class QueryDebtDto extends PaginationDto {
  @ApiPropertyOptional({ enum: DEBT_SORT_FIELDS })
  @IsOptional()
  @IsIn(DEBT_SORT_FIELDS, {
    message: `sortBy debe ser uno de: ${DEBT_SORT_FIELDS.join(', ')}`,
  })
  sortBy?: string = undefined;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc' })
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ enum: DebtStatus })
  @IsOptional()
  @IsEnum(DebtStatus)
  status?: DebtStatus;

  // `@Type(() => Boolean)` convertía el texto "false" en `true`: cualquier
  // cadena no vacía es verdadera. Se traduce a mano.
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean({ message: 'overdue debe ser true o false' })
  overdue?: boolean;
}
