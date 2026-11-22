import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({
    example: 'K7M2PQ9XAB',
    description:
      'Código de la invitación (no distingue mayúsculas ni espacios)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[\s-]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;
}
