import { Controller, Get, Module, Param } from "@nestjs/common";

import { PrismaService } from "../../common/prisma/prisma.service";

@Controller("reports")
class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":scanId")
  async getReport(@Param("scanId") scanId: string) {
    return this.prisma.scanReport.findUnique({
      where: {
        scanId,
      },
    });
  }
}

@Module({
  controllers: [ReportsController],
  providers: [PrismaService],
})
export class ReportsModule {}
