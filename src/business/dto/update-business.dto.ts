import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateBusinessDto } from './create-business.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Las aceptaciones legales son de la creación, no de la edición. La moneda
// tampoco se edita: cambiarla con deudas registradas les cambiaría el sentido.
export class UpdateBusinessDto extends PartialType(
  OmitType(CreateBusinessDto, [
    'acceptedLegalDocumentIds',
    'currency',
  ] as const),
) {
  @ApiPropertyOptional({ example: 'Mi negocio', maxLength: 100 })
  name?: string;

  @ApiPropertyOptional({
    example: 'Calle 123 #45-67',
    nullable: true,
    description: 'Vacía o null la borra',
  })
  address?: string | null;
}
