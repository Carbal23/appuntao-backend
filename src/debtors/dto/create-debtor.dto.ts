import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DocumentType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsColombianPhone,
  IsDocumentNumber,
} from 'src/common/validation/contact.validators';

export class CreateDebtorDto {
  @ApiProperty({ example: 'Pedro Perez' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: '3008923910',
    description: 'Celular o fijo de Colombia; se guarda con 10 dígitos',
  })
  @IsOptional()
  @IsColombianPhone()
  phone?: string;

  @ApiProperty({ example: 'CC' })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @ApiProperty({
    example: '9129384',
    description: 'Si viene documentType, se valida con sus reglas',
  })
  @IsOptional()
  @IsDocumentNumber()
  documentNumber?: string;

  @ApiProperty({ example: 'Cliente nuevo' })
  @IsOptional()
  @IsString()
  notes?: string;
}
