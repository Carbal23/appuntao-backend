import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LegalAudience } from '@prisma/client';

export class LegalDocumentSummaryDto {
  @ApiProperty({ example: '6b1f3c2e-8a4d-4c9b-9e2f-1a2b3c4d5e6f' })
  id!: string;

  @ApiProperty({
    example: 'PRIVACY_POLICY',
    description:
      'Código del tipo (LegalDocumentKind). El catálogo puede crecer: el frontend no debe asumir una lista fija.',
  })
  type!: string;

  @ApiProperty({ example: '2026-10' })
  version!: string;

  @ApiProperty({
    example: 'Política de Tratamiento de Datos Personales',
    description: 'Nombre del documento para mostrar al usuario',
  })
  title!: string;
}

export class LegalDocumentResponseDto extends LegalDocumentSummaryDto {
  @ApiProperty({
    enum: LegalAudience,
    description:
      'ALL_USERS se acepta al registrarse; BUSINESS_OWNERS, al crear un negocio',
  })
  audience!: LegalAudience;

  @ApiProperty({
    description:
      'false = consentimiento opcional: no bloquea ni queda pendiente',
  })
  required!: boolean;

  @ApiProperty({ description: 'Texto completo en Markdown' })
  content!: string;

  @ApiProperty({ description: 'SHA-256 del texto' })
  contentHash!: string;

  @ApiPropertyOptional({ example: 'https://elfiao.com/privacidad' })
  url!: string | null;

  @ApiProperty({ example: '2026-10-16T00:00:00.000Z' })
  publishedAt!: Date;
}
