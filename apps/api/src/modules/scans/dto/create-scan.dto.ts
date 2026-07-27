import { IsNotEmpty, IsOptional, IsString, IsUrl } from "class-validator";

export class CreateScanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;

  @IsUrl({
    require_protocol: true,
  })
  url!: string;
}
