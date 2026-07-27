import { IsNotEmpty, IsString, IsUrl } from "class-validator";

export class CreateScanDto {
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @IsUrl({
    require_protocol: true,
  })
  url!: string;
}
