import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from 'src/common/validation/contact.validators';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'password123' })
  @IsNotEmpty()
  @IsString()
  currentPassword!: string;

  @ApiProperty({
    example: 'NuevaClave2026',
    minLength: 8,
    description: 'Mínimo 8 caracteres, con al menos una letra y un número',
  })
  @IsStrongPassword()
  newPassword!: string;
}
