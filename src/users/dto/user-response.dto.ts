// src/users/dto/user-response.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { Role, DocumentType } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Juan' })
  firstName!: string;

  @ApiProperty({ example: 'Pérez' })
  lastName!: string;

  @ApiProperty({ enum: DocumentType })
  documentType!: DocumentType;

  @ApiProperty({ example: '12345678' })
  documentNumber!: string;

  @ApiProperty({ required: false, nullable: true })
  email?: string | null;

  @ApiProperty({ required: false, nullable: true })
  phone?: string | null;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Cuándo confirmó su correo con un código. null: sin verificar',
  })
  emailVerifiedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
