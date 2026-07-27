import { Module } from "@nestjs/common";

import { PrismaService } from "../../common/prisma/prisma.service";
import { ScansController } from "./scans.controller";
import { ScansService } from "./scans.service";

@Module({
  controllers: [ScansController],
  providers: [ScansService, PrismaService],
})
export class ScansModule {}
