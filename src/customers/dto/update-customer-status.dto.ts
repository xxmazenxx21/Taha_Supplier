import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserStatus } from '../../../generated/prisma/client.js';

export class UpdateCustomerStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;

  /** Required (non-empty) when status is BANNED; cleared when ACTIVE. */
  @IsOptional()
  @IsString()
  block_reason?: string;
}
