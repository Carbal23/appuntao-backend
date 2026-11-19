import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AcceptLegalDocumentsDto {
  @ApiProperty({
    type: [String],
    example: ['6b1f3c2e-8a4d-4c9b-9e2f-1a2b3c4d5e6f'],
    description: 'Ids de los documentos que el usuario acepta',
  })
  @IsArray({ message: 'documentIds debe ser una lista de ids de documentos' })
  @ArrayNotEmpty({ message: 'Debes aceptar al menos un documento' })
  @IsUUID('all', {
    each: true,
    message: 'Cada id de documento debe ser un UUID válido',
  })
  documentIds!: string[];
}
