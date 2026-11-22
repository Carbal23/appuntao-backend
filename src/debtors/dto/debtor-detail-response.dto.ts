import { ApiProperty } from '@nestjs/swagger';
import { DebtorResponseDto } from './debtor-response.dto';
class BusinessBasicDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

/** De la cuenta vinculada el negocio solo ve el nombre. */
export class LinkedUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

export class DebtorDetailResponseDto extends DebtorResponseDto {
  @ApiProperty({ type: BusinessBasicDto })
  business!: BusinessBasicDto;

  @ApiProperty({ type: LinkedUserDto, nullable: true })
  user!: LinkedUserDto | null;

  @ApiProperty({
    type: [Object],
    description:
      'Todas las deudas con sus pagos, sin paginar, de la más reciente a la más antigua',
  })
  debts!: any[];
}
