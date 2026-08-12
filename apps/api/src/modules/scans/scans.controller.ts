import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";

import { CreateScanDto } from "./dto/create-scan.dto";
import { ScansService } from "./scans.service";

@Controller("scans")
export class ScansController {
  constructor(private readonly scansService: ScansService) {}

  @Get()
  async listScans(@Headers("x-user-id") userId?: string) {
    return this.scansService.listScans(userId);
  }

  @Post()
  async createScan(
    @Body() body: CreateScanDto,
    @Headers("x-user-id") userId?: string,
  ) {
    return this.scansService.createScan({
      userId,
      storeId: body.storeId,
      url: body.url,
      financialAssumptions: {
        monthlyTraffic: body.monthlyTraffic,
        averageOrderValueCents: body.averageOrderValueCents,
        baseConversionRate: body.baseConversionRate,
      },
    });
  }

  @Get(":scanId")
  async getScan(
    @Param("scanId") scanId: string,
    @Headers("x-user-id") userId?: string,
  ) {
    return this.scansService.getScanById(scanId, userId);
  }
}
