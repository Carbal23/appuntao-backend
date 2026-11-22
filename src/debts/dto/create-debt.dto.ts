import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';

// Lo que cabe en `Decimal(12, 2)`. Un monto más grande fallaba en la base con
// un 500 en lugar de un 400.
export const MAX_DEBT_AMOUNT = 9_999_999_999.99;

export class CreateDebtDto {
  @ApiProperty({ example: '6f1c2a3b-0000-4000-8000-000000000000' })
  @IsUUID(undefined, { message: 'El deudor no es válido' })
  @IsNotEmpty()
  debtorId!: string;

  @ApiProperty({
    example: 100000,
    description: 'Mayor que cero, con máximo dos decimales',
  })
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'El monto debe ser un número con máximo dos decimales' },
  )
  @IsPositive({ message: 'El monto debe ser mayor a cero' })
  @Max(MAX_DEBT_AMOUNT, { message: 'El monto es demasiado grande' })
  amount!: number;

  @ApiPropertyOptional({
    example: 'Mercado de la semana',
    maxLength: 200,
    description: 'Se recorta; vacía se guarda como nula',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(200, { message: 'La descripción admite máximo 200 caracteres' })
  description?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    type: String,
    format: 'date-time',
    description: 'Fecha ISO 8601; no puede estar en el pasado',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'La fecha de vencimiento no es válida' })
  dueDate?: Date;
}
