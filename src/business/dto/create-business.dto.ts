import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** La app muestra todo en pesos colombianos: por ahora es la única moneda. */
export const BUSINESS_CURRENCIES = ['COP'] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBusinessDto {
  @ApiProperty({ example: 'Mi negocio', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Escribe el nombre del negocio' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'Calle 123 #45-67',
    required: false,
    nullable: true,
    description: 'Vacía o null la borra',
  })
  // Una dirección vacía se guarda como null.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiProperty({ example: 'COP', required: false, enum: BUSINESS_CURRENCIES })
  @IsOptional()
  @IsIn(BUSINESS_CURRENCIES, { message: 'Por ahora la moneda es COP' })
  currency?: string;

  @ApiProperty({
    type: [String],
    required: false,
    example: ['6b1f3c2e-8a4d-4c9b-9e2f-1a2b3c4d5e6f'],
    description:
      'Ids de los documentos vigentes para negocios que acepta (GET /legal/current?audience=BUSINESS_OWNERS). Puede omitirse si ya los aceptó, por ejemplo al crear su segundo negocio.',
  })
  @IsOptional()
  @IsArray({
    message: 'acceptedLegalDocumentIds debe ser una lista de ids de documentos',
  })
  @IsUUID('all', {
    each: true,
    message: 'Cada id de documento legal debe ser un UUID válido',
  })
  acceptedLegalDocumentIds?: string[];
}
