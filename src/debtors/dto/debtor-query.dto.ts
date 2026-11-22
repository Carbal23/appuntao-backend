import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/pagination/dto/pagination.dto';

/**
 * Campos por los que se puede ordenar el listado. Cualquier otro valor llegaba
 * tal cual a Prisma y respondía 500.
 */
export const DEBTOR_SORT_FIELDS = [
  'name',
  'createdAt',
  'updatedAt',
  'phone',
  'documentNumber',
] as const;

/**
 * Filtros del listado de deudores.
 *
 * Extiende el DTO de paginación común en vez de modificarlo porque `hasDebt`
 * solo tiene sentido aquí, y `PaginationDto` lo comparten ocho servicios.
 */
export class DebtorQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: DEBTOR_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(DEBTOR_SORT_FIELDS, {
    message: `sortBy debe ser uno de: ${DEBTOR_SORT_FIELDS.join(', ')}`,
  })
  sortBy?: string = undefined;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc' })
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    description:
      'true: solo deudores con saldo pendiente. false: solo los que están al día.',
    example: true,
  })
  @IsOptional()
  // Los query params llegan siempre como string; sin esto `"false"` sería
  // truthy y el filtro de "al día" devolvería justo lo contrario.
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  hasDebt?: boolean;
}
