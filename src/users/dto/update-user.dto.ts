import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType, Role } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

// La contraseña no se cambia por aquí: va por PATCH /users/me/password, que
// exige la contraseña actual. Las aceptaciones legales van por /legal/accept.
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'acceptedLegalDocumentIds'] as const),
) {
  @ApiPropertyOptional({ example: 'Juan', required: false })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Pérez' })
  lastName?: string;

  @ApiPropertyOptional({ enum: DocumentType, example: DocumentType.CC })
  documentType?: DocumentType;

  @ApiPropertyOptional({ example: '1032876361' })
  documentNumber?: string;

  @ApiPropertyOptional({ example: 'correo@email.com' })
  email?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  phone?: string;

  // El registro público no acepta rol; aquí solo lo puede cambiar un ADMIN.
  @ApiPropertyOptional({ enum: Role, example: Role.USER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
