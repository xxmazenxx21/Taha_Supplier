import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class CreateCartDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  user_id: number;
}
