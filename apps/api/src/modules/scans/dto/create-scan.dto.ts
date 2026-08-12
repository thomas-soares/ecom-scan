import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateScanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;

  @IsUrl({
    require_protocol: true,
  })
  url!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyTraffic?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  averageOrderValueCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseConversionRate?: number;
}
