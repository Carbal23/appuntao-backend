import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from 'src/users/dto/user-response.dto';
import { LegalDocumentSummaryDto } from 'src/legal/dto/legal-document-response.dto';

export class TokenResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: '15m' })
  accessTokenExpiresIn!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ example: '2026-05-01T00:00:00.000Z' })
  refreshTokenExpiresAt!: string;

  @ApiProperty({
    type: [LegalDocumentSummaryDto],
    description:
      'Documentos legales vigentes que el usuario no ha aceptado. Si no está vacío, el frontend debe mostrarlos (GET /legal/pending) y registrar la aceptación (POST /legal/accept).',
  })
  pendingLegalDocuments!: LegalDocumentSummaryDto[];
}
