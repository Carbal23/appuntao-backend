import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { Role, DocumentType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'Juan' })
  @IsNotEmpty()
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Pérez' })
  @IsNotEmpty()
  @IsString()
  lastName!: string;

  @ApiProperty({ enum: DocumentType, example: DocumentType.CC })
  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @ApiProperty({ example: '1032876361' })
  @IsNotEmpty()
  @IsString()
  documentNumber!: string;

  @ApiProperty({ example: 'correo@email.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '3001234567', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @ApiProperty({ enum: Role, example: Role.USER, required: false })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiProperty({
    type: [String],
    example: [
      '6b1f3c2e-8a4d-4c9b-9e2f-1a2b3c4d5e6f',
      '0c9d8e7f-6a5b-4c3d-2e1f-0a9b8c7d6e5f',
    ],
    description:
      'Ids de los documentos legales vigentes que el usuario acepta (GET /legal/current?audience=ALL_USERS). Deben estar todos los obligatorios.',
  })
  @IsArray({
    message: 'acceptedLegalDocumentIds debe ser una lista de ids de documentos',
  })
  @ArrayNotEmpty({
    message: 'Debes aceptar los documentos legales para crear tu cuenta',
  })
  @IsUUID('all', {
    each: true,
    message: 'Cada id de documento legal debe ser un UUID válido',
  })
  acceptedLegalDocumentIds!: string[];
}
