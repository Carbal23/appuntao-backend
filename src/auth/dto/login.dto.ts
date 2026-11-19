import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: '12345678',
    description: 'Puede ser email, teléfono o número de documento',
  })
  @IsNotEmpty()
  @IsString()
  identifier!: string;

  @ApiProperty({
    example: 'password123',
  })
  @IsNotEmpty()
  @IsString()
  password!: string;

  @ApiProperty({
    example: '3f2b8c1e-6d4a-4f7e-9b1a-2c5d8e9f0a1b',
    description:
      'Identificador aleatorio de la instalación (UUID). La app lo genera al abrirse por primera vez y el navegador en la primera visita, y lo guardan para enviarlo siempre igual.',
  })
  @IsString()
  @Length(8, 128)
  deviceId!: string;

  @ApiProperty({
    example: 'Samsung Galaxy A54 · Android 14',
    required: false,
    description: 'Nombre legible del dispositivo, para mostrar las sesiones',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;

  @ApiProperty({
    required: false,
    description:
      'Enviar true para reactivar una cuenta desactivada por el propio usuario o cancelar una eliminación pendiente (después de recibir 403 ACCOUNT_DEACTIVATED o ACCOUNT_DELETION_PENDING).',
  })
  @IsOptional()
  @IsBoolean()
  reactivate?: boolean;
}
