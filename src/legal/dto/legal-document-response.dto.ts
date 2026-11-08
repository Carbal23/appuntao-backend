import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LegalDocumentType } from '@prisma/client';

export class LegalDocumentSummaryDto {
  @ApiProperty({ example: '6b1f3c2e-8a4d-4c9b-9e2f-1a2b3c4d5e6f' })
  id!: string;

  @ApiProperty({ enum: LegalDocumentType })
  type!: LegalDocumentType;

  @ApiProperty({ example: '2026-10' })
  version!: string;
}

export class LegalDocumentResponseDto extends LegalDocumentSummaryDto {
  @ApiProperty({ description: 'Texto completo en Markdown' })
  content!: string;

  @ApiProperty({ description: 'SHA-256 del texto' })
  contentHash!: string;

  @ApiPropertyOptional({ example: 'https://appuntao.co/privacidad' })
  url!: string | null;

  @ApiProperty({ example: '2026-10-16T00:00:00.000Z' })
  publishedAt!: Date;
}
