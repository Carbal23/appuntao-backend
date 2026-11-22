import { PartialType } from '@nestjs/mapped-types';
import { CreateDebtorDto } from './create-debtor.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';

export class UpdateDebtorDto extends PartialType(CreateDebtorDto) {
  @ApiPropertyOptional({ example: 'Pedro Perez', required: false })
  name?: string;

  @ApiPropertyOptional({ example: '3008923910', required: false })
  phone?: string;

  @ApiPropertyOptional({ example: 'CC', required: false })
  documentType?: DocumentType;

  @ApiPropertyOptional({ example: '9129384', required: false })
  documentNumber?: string;

  @ApiPropertyOptional({ example: 'Cliente nuevo', required: false })
  notes?: string;
}
