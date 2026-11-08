import { ArrayNotEmpty, IsArray, IsEnum, IsUUID } from 'class-validator';
import { DocumentType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsDocumentNumber,
  IsPersonName,
  IsRequiredColombianPhone,
  IsRequiredEmail,
  IsStrongPassword,
} from 'src/common/validation/contact.validators';

export class CreateUserDto {
  @ApiProperty({ example: 'Juan' })
  @IsPersonName()
  firstName!: string;

  @ApiProperty({ example: 'Pérez' })
  @IsPersonName()
  lastName!: string;

  @ApiProperty({ enum: DocumentType, example: DocumentType.CC })
  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @ApiProperty({
    example: '1032876361',
    description:
      'CC: 6 a 10 dígitos; NIT: 9 dígitos, o 10 con el de verificación; extranjería: 3 a 20 letras o números. Se aceptan puntos, espacios y guiones, que se eliminan.',
  })
  @IsDocumentNumber()
  documentNumber!: string;

  @ApiProperty({
    example: 'correo@email.com',
    description: 'Obligatorio. Se guarda en minúsculas',
  })
  @IsRequiredEmail()
  email!: string;

  @ApiProperty({
    example: '3001234567',
    description:
      'Obligatorio. Celular o fijo de Colombia. Se acepta con espacios o con +57; se guarda con 10 dígitos.',
  })
  @IsRequiredColombianPhone()
  phone!: string;

  @ApiProperty({
    example: 'Clave2026',
    minLength: 8,
    description: 'Mínimo 8 caracteres, con al menos una letra y un número',
  })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({
    type: [String],
    example: [
      '6b1f3c2e-8a4d-4c9b-9e2f-1a2b3c4d5e6f',
      '0c9d8e7f-6a5b-4c3d-2e1f-0a9b8c7d6e5f',
    ],
    description:
      'Ids de los documentos legales vigentes que el usuario acepta (GET /legal/current). Deben ser todos los vigentes.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  acceptedLegalDocumentIds!: string[];
}
