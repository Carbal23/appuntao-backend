import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';

export const BUSINESS_SORT_FIELDS = ['createdAt', 'name'] as const;

export class QueryBusinessDto extends PaginationDto {
  @ApiPropertyOptional({ enum: BUSINESS_SORT_FIELDS })
  @IsOptional()
  @IsIn(BUSINESS_SORT_FIELDS, {
    message: `sortBy debe ser uno de: ${BUSINESS_SORT_FIELDS.join(', ')}`,
  })
  sortBy?: (typeof BUSINESS_SORT_FIELDS)[number] = undefined;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc' })
  order?: 'asc' | 'desc' = 'desc';
}
