import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import {
  IsNormalizedEmail,
  IsStrongPassword,
} from 'src/common/validation/contact.validators';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'correo@email.com',
    description: 'Correo de la cuenta. El código se envía a este correo.',
  })
  @IsNormalizedEmail()
  email!: string;
}

export class VerifyResetCodeDto extends ForgotPasswordDto {
  @ApiProperty({
    example: '482913',
    description: 'Código de 6 dígitos que llegó al correo',
  })
  // Quien copia el código del correo puede traer espacios o guiones.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s-]/g, '') : value,
  )
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code!: string;
}

export class ResetPasswordDto extends VerifyResetCodeDto {
  @ApiProperty({ example: 'nuevaClave123' })
  @IsStrongPassword()
  newPassword!: string;
}
