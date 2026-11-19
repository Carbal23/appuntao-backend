import { ApiPropertyOptional } from '@nestjs/swagger';
import { LegalAudience } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class CurrentLegalDocumentsQueryDto {
  @ApiPropertyOptional({
    enum: LegalAudience,
    description:
      'Solo los documentos de ese público. Sin él, todos los vigentes (para leerlos).',
  })
  @IsOptional()
  @IsEnum(LegalAudience, {
    message: `audience debe ser uno de: ${Object.values(LegalAudience).join(', ')}`,
  })
  audience?: LegalAudience;
}
