import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Min,
  IsOptional,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateScanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;

  @IsUrl({
    require_protocol: false,
  })
  url!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  monthlyTraffic!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  averageOrderValueCents!: number;
}
