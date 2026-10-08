import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/** Ensures discount_price is strictly less than price when provided. */
function IsLessThan(property: string, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isLessThan',
      target: (object as any).constructor,
      propertyName,
      constraints: [property],
      options: {
        message: `discount_price cannot be greater than or equal to price`,
        ...validationOptions,
      },
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as string[];
          const relatedValue = (args.object as any)[relatedPropertyName];
          if (value === undefined || value === null) return true;
          if (typeof value !== 'number' || typeof relatedValue !== 'number')
            return true;
          return value < relatedValue;
        },
      },
    });
  };
}

export class CreateProductDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subcategory_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  brand_id: number;

  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  // image and images are handled by Multer (multipart/form-data fields)

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsLessThan('price')
  discount_price?: number;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_available?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_best_seller?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_new?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  display_order?: number;
}
