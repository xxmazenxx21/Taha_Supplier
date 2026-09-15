import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class CreateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  product_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  quantity: number;
}
