import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationStatus, InvitationType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListInvitationsQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: InvitationStatus })
  @IsOptional()
  @IsEnum(InvitationStatus)
  status?: InvitationStatus;

  @ApiPropertyOptional({ enum: InvitationType })
  @IsOptional()
  @IsEnum(InvitationType)
  type?: InvitationType;
}
