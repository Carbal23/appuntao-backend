import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateBusinessDto {
  @ApiProperty({ example: 'Mi negocio', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'Calle 123 #45-67', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiProperty({ example: 'COP', required: false })
  @IsOptional()
  @IsString()
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
